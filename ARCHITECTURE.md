# Scouter - Architecture and Decision Record

> This document is the authoritative reference for any LLM or agent working on this codebase.
> Read this before making changes. It captures the decisions, constraints, and rationale
> behind the current design - not just what was built, but why.

---

## What Scouter Is

Scouter is a browser-side React app that generates practical suburb reviews for people
deciding where to live in Australia. A user enters a suburb and state, the app fetches
real infrastructure data from OpenStreetMap, then calls an LLM to generate a structured
JSON review covering property, infrastructure, environment, safety, and demographics.
Scores are computed deterministically client-side from the LLM output.

Production URL: `https://scouter.mrated.dev`

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React + TypeScript + Vite | Static SPA, no SSR |
| Styling | Plain CSS (`App.css`) | No CSS-in-JS, no Tailwind |
| Fonts | Figtree (Google Fonts, weight 900) | Brand wordmark only |
| PDF export | jspdf (client-side) | No server involvement |
| Deployment | Cloudflare Pages | Auto-deploys on push to `main` |
| Backend | Cloudflare Worker (`worker/index.ts`) | Share/store only - not LLM proxy |
| KV storage | Cloudflare KV namespace `REVIEWS` | Shared reviews + benchmark cache |
| LLM calls | Browser-direct to provider APIs | No server proxy for LLM |

---

## Architecture Shape

```
Browser
  ├── Nominatim API (geocode suburb → bbox + centre)
  ├── Overpass API  (OSM infrastructure data)
  ├── Homely.com.au (community suburb context, scraped)
  ├── LLM Provider  (Azure / OpenAI / Gemini / Anthropic / DeepSeek)
  └── Cloudflare Worker
        ├── POST /reviews    (store shared review in KV)
        ├── GET  /reviews/:id (retrieve shared review)
        ├── GET  /benchmarks  (cached AU property benchmarks)
        └── POST /llm/anthropic (proxy route - unused, kept for future)
```

**Key principle:** The browser calls LLM providers directly. There is no server-side LLM
proxy. API keys are stored in `localStorage`. This is a deliberate choice - same risk
model as Gemini/OpenAI browser SDKs. Users are informed keys are stored locally.

---

## Data Flow for a Review Request

1. User enters suburb + state
2. Three parallel fetches fire:
   - `fetchHomelyContext(suburb, state)` - scrapes Homely.com.au for community context (~2500 chars)
   - `fetchBenchmarks()` - gets AU property growth benchmarks from Worker KV (or hardcoded fallback)
   - `fetchOsmContext(suburb, state)` - Nominatim geocode + Overpass infrastructure query
3. `callLlm(settings, query, homelyContext, liveBenchmarks, osmContext)` sends the combined prompt
4. LLM returns a JSON review object
5. OSM data **overrides** specific LLM fields post-response:
   - `infrastructure.majorRoads` - replaced with OSM roads (authoritative)
   - `infrastructure.trainStations` - replaced with OSM stations + real distances (authoritative)
   - `infrastructure.suburbLat` / `suburbLng` - replaced with bbox midpoint (prevents 8000km CBD distances)
6. `computeScores(review, liveBenchmarks)` scores the review deterministically client-side
7. Review is cached in `localStorage` and displayed

---

## OSM Grounding (src/services/osm.ts)

OSM data is used as ground truth for infrastructure that LLMs frequently hallucinate.

### Geocoding
- **Nominatim** (`nominatim.openstreetmap.org`) geocodes suburb + state to a bounding box
- Critically: fetch 5 results and prefer `class=boundary, type=administrative` - the first
  result is often a point feature (e.g. a train station) with a tiny bbox, not the suburb boundary
- Centre point is derived from `(bbox.south + bbox.north) / 2` - NOT from Nominatim's `lat`/`lon`
  field which may point to a specific feature

### Overpass query
Two bboxes are used:
- **Suburb bbox**: from the administrative boundary + 0.001 deg buffer. Used for roads,
  schools, parks, shops, medical, dining, POIs - features that should be within the suburb.
- **Station bbox**: 4km radius circle from suburb centre. Used for train stations, ferry
  terminals - transit users accept a walk/short trip to nearby stations.

Train stations query both `node["railway"="station"]` AND `way["railway"="station"]` -
some stations (e.g. Spotswood) are mapped as ways in OSM, not nodes.

Output uses `out center body` (not `out tags`) so that:
- Nodes return top-level `lat`/`lon`
- Ways/relations return `center.lat`/`center.lon`

### Ferry / water transport
Query: `node["amenity"="ferry_terminal"]`, `way["amenity"="ferry_terminal"]`,
`way["route"="ferry"]`, `relation["route"="ferry"]`, `relation["amenity"="ferry_terminal"]`

Route names like "Westgate Punt: Spotswood - Fishermans Bend" are normalised by splitting
on `:` and taking the first part, then deduplicating.

### What OSM does and doesn't cover well (Australia)
| Category | Quality |
|---|---|
| Roads (motorway to secondary) | Excellent |
| Train stations | Excellent |
| Tram stops | Good |
| Schools | Very good |
| Parks | Excellent |
| Supermarkets | Good |
| Medical centres | Good |
| Ferry terminals | Good |
| Restaurants/cafes | Patchy - many small venues not mapped |

For dining, OSM names are passed as context but the LLM is allowed to supplement with
its own knowledge for venues not in OSM.

---

## LLM Integration (src/services/llm.ts)

### Providers
| Provider | Auth | Notes |
|---|---|---|
| Azure AI | Endpoint + deployment + api-key | Uses Responses API (`/openai/responses`) |
| OpenAI | Bearer token | Chat Completions, `max_completion_tokens` |
| Gemini | API key in URL | `generateContent`, `responseMimeType: application/json` |
| Anthropic | `x-api-key` header + `anthropic-dangerous-direct-browser-access: true` | Direct browser calls explicitly supported by Anthropic |
| DeepSeek | Bearer token | Chat Completions compatible |

### Prompt structure
- `buildSystemPrompt()` - static instructions, JSON schema, scoring rubrics. Safe to cache.
- `buildUserMessage(query, homelyContext, osmContext)` - per-request. Contains suburb name,
  Homely context in `<homely_context>` tags, OSM data in `<osm_context>` tags.
- `buildPrompt()` - combines both for providers without a separate system field.

For Anthropic, `buildSystemPrompt()` is sent in the `system` field with
`cache_control: { type: 'ephemeral' }` for prompt caching. The user message is separate.

### Token limit
9,000 output tokens across all providers. Prompt is designed to stay well within this.

### Temperature
`temperature: 0.2` for all providers except Anthropic (deprecated on newer Claude models - omitted).

### Retry logic
3 retries with 1.2s base delay (multiplied by attempt number) on 5xx responses only.
Client errors (4xx) are not retried. Timeout: 60 seconds total.

---

## Scoring (src/services/scoring.ts)

All scores are computed **deterministically client-side** from the LLM JSON output.
The LLM never generates scores. This ensures consistency across providers and runs.

### Score range
All scores: 1.0-10.0, rounded to 1 decimal place.

### Level mapping (used throughout)
`Low → 10, Medium → 5, High → 2, Very High → 1`
"Low" means best for risk/noise/pollution fields.

### Property score
- Primary: 12-month suburb growth vs state benchmark (70% weight)
- Secondary: 5-year annualised suburb growth vs benchmark (30% weight)
- Benchmark source: Cloudflare Worker KV (fetched weekly by cron) with hardcoded PropTrack
  HPI April 2026 fallback. **Never uses LLM-generated benchmark fields** - they vary between runs.
- Ratio scoring: benchmark growth = 6/10. 2x benchmark = 10/10. Half benchmark = ~2/10.

### Safety score
Blended: 70% crime + 30% natural risks.

Crime component:
- Weighted average of crimeType levels
- Assault: 2x weight, Break & Enter: 2x, Vehicle theft: 1.5x, others: 1x
- Missing data defaults to neutral 5

Natural risk component:
- Weighted average of naturalRisk levels
- Bushfire: 2x weight, Flood: 2x, others: 1x
- Missing data defaults to neutral 5

### Infrastructure score
Three equal buckets averaged: Transit (train + bus), Services (schools + medical + shopping),
Amenity (parks + POIs). Each bucket scored 1-10.

Thresholds scale by population tier (small < 8k, medium 8k-40k, large > 40k) so small
suburbs aren't penalised for lacking metro-scale infrastructure.

### Environment score
Four equal quarters: air quality, noise, climate comfort, wind.
Climate comfort: average of summer-max score and winter-min score (parsed from LLM text).

### Overall score
Simple arithmetic mean of the four sub-scores.

---

## Review Data Shape

The canonical TypeScript type is `Review` in `src/types.ts`. Key fields:

```
Review {
  exists: boolean          // false if suburb not found
  suburb, state, postcode
  summary                  // 2-4 sentence overall assessment
  briefs                   // one-sentence summaries per tab
  marketNarrative, marketRows[]
  infrastructure {
    transit, education, lifestyle, demographic  // narrative strings
    trainStations[]: { name, lines, distanceKm }
    tramStops, busAvailability
    majorRoads[]
    cbdDistanceKm, cbdCommuteMinutes
    suburbLat, suburbLng   // OVERRIDDEN from OSM after LLM call
    primarySchools, primarySchoolNames[]
    secondarySchools, secondarySchoolNames[]
    shoppingPrecincts, shoppingPrecinctNames[]
    parks, parkNames[]
    medicalCentres, medicalCentreNames[]
    restaurants, restaurantNames[]
    pointsOfInterest[]: { icon: emoji, label }
  }
  climate { summerAverages, winterAverages, airQuality, noise, wind }
  crime { narrative, insuranceImpact, crimeTypes[], naturalRisks[] }
  demographics { summary, population, ageGroups[], ... }
  caveats[], briefCaveats[], references[]
  scores: ReviewScores     // computed client-side, not from LLM
}
```

---

## Share System (src/services/share.ts + worker/index.ts)

- `POST /reviews` stores a review JSON in KV with a nanoid key (TTL: 1 year)
- `GET /reviews/:id` retrieves it
- Share URL format: `https://scouter.mrated.dev/r/:id`
- `public/_redirects` serves `index.html` for `/r/*` so the SPA handles routing
- Worker URL: `https://scouter-reviews.soutarm.workers.dev`
- In Vite dev: falls back to `http://localhost:8787`

---

## Benchmark Refresh (worker/index.ts)

- Cloudflare Worker cron (`0 3 * * 1` - Monday 3am UTC) calls Gemini to fetch fresh
  AU property benchmarks and stores them in KV under `benchmarks:au` with 8-day TTL
- `GET /benchmarks` returns the cached value or 404 if not yet populated
- App falls back to `FALLBACK_BENCHMARKS` in `scoring.ts` if Worker returns 404/error
- Hardcoded fallbacks sourced from PropTrack HPI April 2026. Update quarterly.

---

## Component Structure

```
src/
  App.tsx                        Main app - state, routing, search orchestration
  App.css                        All styles (single file, no modules)
  types.ts                       All TypeScript types
  services/
    llm.ts                       LLM providers, prompt building, callLlm
    osm.ts                       Nominatim + Overpass, OsmResult type
    scoring.ts                   Deterministic score computation
    reviewParser.ts              Parses LLM JSON → Review type
    share.ts                     Share URL generation + Worker calls
    cache.ts                     localStorage review cache
    location.ts                  Haversine, CBD coordinates, state detection
  components/
    SettingsPanel.tsx            Provider config, model selection (dynamic fetch)
    HeroSearchSection.tsx        Landing page search UI
    BusyIconMorph.tsx            Cycling category icons during loading
    review/
      InfrastructureTab.tsx      Transit, services, green space cards
      PropertyTab.tsx            Market data table + growth chart
      EnvironmentTab.tsx         Air, noise, climate, wind panels
      CrimeTab.tsx               Crime types + natural hazards
      DemographicsTab.tsx        Age/household/tenure charts
      MapTab.tsx                 Embedded map view
      ScoreRing.tsx              Circular score display
      TabPageHeader.tsx          Tab header with score + brief
      SharedReviewBanner.tsx     Banner for shared review views
      [other display components]
```

---

## Settings and Model Selection

Provider settings are stored in `localStorage` under `scouter.*` keys.

Model lists are fetched dynamically from provider APIs when an API key is entered
(800ms debounce). Falls back to hardcoded lists if fetch fails:
- OpenAI: `GET /v1/models` filtered to `gpt-*` and `o[1-9]*`
- Gemini: `GET /v1beta/models` filtered to `generateContent`-capable models
- Anthropic: `GET /v1/models` with `anthropic-dangerous-direct-browser-access: true`
- DeepSeek: hardcoded (no public models endpoint)

---

## UI Conventions

- **No em dashes** anywhere in UI text, copy, prompts, or comments. Use hyphens or rewrite.
- **Named lists cap at 8** from LLM (raised from 4 to allow OSM data through), display at 5 with "+n more" row
- **Infrastructure tab** groups: Transport / Services / Green Space and Lifestyle
- **Loading state**: compass spinner (SVG, animated needle sweep) + cycling category icons + cycling text messages
- **Brand wordmark**: Figtree 900, uppercase, `letter-spacing: -0.04em`, `text-shadow` glow
- **Busy card**: `border-radius: 48px` mobile, `100px` desktop
- **Score rings** display computed scores (1-10), not LLM-generated values

---

## Versioning

Follows Semantic Versioning. Version string lives in `src/components/SettingsPanel.tsx`.
Bump on every commit that ships to `main`.

- **Patch** (1.0.x): bug fixes, prompt tweaks, copy changes, minor styling
- **Minor** (1.x.0): new features or UI sections
- **Major** (x.0.0): breaking data shape changes, major UX overhauls, scoring model changes

Current version: **v1.2.19**

Include version in commit message: `v1.2.19: blend natural risks into safety score`

---

## Known Issues and Constraints

- **Overpass rate limiting**: the Overpass API rate-limits aggressively under load.
  The app handles this gracefully (returns `null`, review proceeds without OSM data).
- **Nominatim result ordering**: always prefer `class=boundary, type=administrative`.
  The first result may be a point feature (train station, shop) sharing the suburb name.
- **OSM dining coverage**: patchy for small/new venues. LLM supplements with training
  knowledge. Do not treat OSM dining names as authoritative.
- **Anthropic temperature**: `temperature` is deprecated on Claude 3.5+ models. Omit it.
- **Zscaler/TLS on dev machine**: Wrangler and some fetch calls fail locally due to
  certificate interception. Browser fetches work fine. Not a production issue.
- **suburbLat/suburbLng**: always overridden from OSM bbox midpoint post-LLM call.
  Do not rely on LLM-generated coordinates - they may point to station locations or
  be wildly inaccurate (seen: 8000km from Melbourne CBD for Spotswood).
- **Ferry terminals**: query uses both `amenity=ferry_terminal` and `route=ferry` on
  nodes, ways, and relations. Route names with directional suffixes (e.g.
  "Westgate Punt: Spotswood - Fishermans Bend") are normalised by splitting on `:`.

---

## What NOT to Do

- Do not add server-only patterns that break static deployment (Worker is the only backend)
- Do not change `vite.config.ts` base path or `public/_redirects` without careful thought
- Do not commit API keys or secrets
- Do not use `temperature` in Anthropic requests
- Do not trust LLM-generated `suburbLat`/`suburbLng` - always use OSM override
- Do not use the Nominatim first result without checking `class=boundary`
- Do not batch-update the version string - bump once per shipped commit
- Do not introduce em dashes in any copy, prompt, or comment

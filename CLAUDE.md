# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Common Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Starts Vite development server with hot‑module replacement. |
| `npm run build` | Builds the production bundle (`dist/`). |
| `npm run lint` | Runs ESLint to check code style and potential issues. |
| `npm run test` | Executes Vitest unit/integration tests. Use `npm run test -- <test-name>` to run a single test file. |
| `npm run preview` | Serves the built app locally (uses `dist/`). |
| `npm run worker:dev` | Starts the Cloudflare Worker dev server for local backend testing. |
| `npm run worker:deploy` | Deploys the Worker to Cloudflare. Requires `wrangler.toml` configuration and KV namespace `REVIEWS`. |

---

## Architecture Overview

Scouter is a **static React SPA** that generates suburb reviews in the browser and stores them on Cloudflare Pages with a **Cloudflare Worker** backend for sharing.

### Core Layers
- **Frontend**: React + TypeScript + Vite. All UI components live in `src/components/`. Styling is done with plain CSS in `App.css`.
- **Build Tool**: Vite (`vite.config.ts`). Base path is `'/'`; production URL is `https://scouter.mrated.dev`.
- **Deployment**: Auto‑deploy on push to `main` via Cloudflare Pages. The build output directory is `dist/`.
- **Backend**: Cloudflare Worker (`worker/index.ts`) provides:
  - `POST /reviews` – stores a review in KV (TTL 1 year).
  - `GET /reviews/:id` – retrieves a review.
  - `GET /benchmarks` – serves cached property benchmarks.
  - `POST /llm/anthropic` – CORS proxy that forwards a user-supplied Anthropic API key; the key is never stored.
  - `POST /llm/free` – zero-config review generation using Scouter's own OpenRouter key (`OPENROUTER_API_KEY` secret). Accepts **only** structured `{ suburb, state, homelyContext?, osmContext? }` – never client-supplied prompt text – and builds the fixed Scouter review prompt itself, so the shared key can't be used as a general-purpose LLM proxy. Rate-limited per IP and globally via KV counters.
- **Data Sources**:
  - **Nominatim** (geocoding) and **Overpass** (infrastructure data) via OSM.
  - **Homely.com.au** (community context) – scraped client‑side.
  - **LLM providers** (Azure, OpenAI, Gemini, Anthropic, DeepSeek) – called directly from the browser; API keys are stored in `localStorage`.
- **Scoring**: All scores are computed **client‑side** from the LLM output (deterministic, not supplied by the LLM). Categories:
  - Property (70 % growth vs benchmark, 30 % 5‑year growth)
  - Safety (70 % crime, 30 % natural risk)
  - Infrastructure (transit, services, amenities)
  - Environment (air, noise, climate, wind)
  - Overall = simple mean of the four sub‑scores.

### Critical Design Decisions
- **No server‑side LLM proxy, except the scoped free tier** – provider API keys are client‑side; users are informed of this risk. The one exception is `POST /llm/free` (see Backend above), which holds a shared OpenRouter key server‑side but only ever runs the fixed Scouter review prompt against structured inputs – it cannot be used as a general chat proxy – and is rate‑limited per IP/globally. This is the default provider for first‑time visitors (`defaultSettings.provider` in `App.tsx`); anyone wanting unlimited use, a different model, or higher quality should add their own key.
- **OSM grounding** – OSM data overrides LLM fields for `infrastructure.majorRoads`, `trainStations`, and location coordinates (`suburbLat` / `suburbLng`) to avoid massive errors (e.g., 8000 km distance bug).
- **Scoring rubric** – Uses level mapping `Low → 10, Medium → 5, High → 2, Very High → 1` for risk/noise/pollution fields.
- **Versioning** – Follows Semantic Versioning; version string lives in `src/components/SettingsPanel.tsx`. Bump once per commit that ships to `main`.

---

## UI/UX Conventions

- No em dashes (`—`) in any UI text, copy, or comments.
- Named lists cap at **8** items; display up to **5** with “+n more” for the rest.
- Loading state shows a compass spinner, cycling category icons, and rotating text messages.
- Brand wordmark uses **Figtree 900**, uppercase, `letter-spacing: -0.04em`, with a subtle glow.
- Score rings display computed scores (1‑10) – never LLM‑generated values.

---

## Data Flow for a Review Request

1. User enters suburb + state.  
2. Three parallel fetches fire:
   - `fetchHomelyContext(suburb, state)` – scrapes Homely.com.au (~2500 chars).  
   - `fetchBenchmarks()` – gets AU property growth benchmarks from Worker KV (or fallback).  
   - `fetchOsmContext(suburb, state)` – Nominatim + Overpass query.
3. `callLlm(settings, query, homelyContext, liveBenchmarks, osmContext)` builds and sends the combined prompt.
4. LLM returns a JSON review object.
5. OSM data **overrides** specific fields post‑response (`infrastructure.majorRoads`, `trainStations`, `suburbLat`/`suburbLng`).
6. `computeScores(review, liveBenchmarks)` calculates deterministic client‑side scores.
7. Review cached in `localStorage` and displayed.

---

## Share System

- Share URL format: `https://scouter.mrated.dev/r/:id`.  
- `POST /reviews` stores the review in KV (TTL 1 year).  
- `GET /reviews/:id` retrieves it.  
- `public/_redirects` rewrites `/r/*` to `index.html` so the SPA handles the route.  
- Worker URL: `https://scouter-reviews.soutarm.workers.dev` (fallback to `http://localhost:8787` in dev).

---

## Key Files & Directories

| Path | Purpose |
|------|---------|
| `src/` | Source code. Contains `App.tsx`, `App.css`, `types.ts`, and sub‑folders (`components/`, `services/`). |
| `src/components/` | React UI components, grouped by feature (e.g., `review/`, `HeroSearchSection.tsx`). |
| `src/services/` | API calls, prompt building, scoring logic (`llm.ts`, `osm.ts`, `scoring.ts`, `share.ts`). |
| `worker/` | Cloudflare Worker source (`index.ts`) and `wrangler.toml` config. |
| `public/` | Static assets (`index.html`, `_redirects`). |
| `dist/` | Production build output. |

---

## Development Tips

- **Testing**: Run `npm run test -- <test-name>` to execute a single test file. Use `vitest` for isolated test runs.
- **Linting**: `npm run lint` checks for style and potential bugs; fix issues before committing.
- **Worker Development**: Use `npm run worker:dev` for local testing; remember that some fetches may fail behind corporate proxies (Zscaler) but work in the browser.
- **Environment Variables**: Provider API keys are stored in `localStorage` under `scouter.*`. Do **not** hard‑code secrets. The Worker's `OPENROUTER_API_KEY` secret (see `worker/wrangler.toml`) powers the shared free tier and must never be exposed client‑side.
- **Version Bumping**: Update `APP_VERSION` in `src/App.tsx` and include it in commit messages (`v1.2.19: blend natural risks into safety score`).
- **Avoid Common Pitfalls**:
  - Do **not** add server‑only patterns that break static deployment.
  - Do **not** modify `vite.config.ts` base path or `public/_redirects` without thorough review.
  - Do **not** commit generated artifacts (e.g., `dist/`) or API secrets.
  - Do **not** use em dashes anywhere in copy or comments.
  - Do **not** rely on LLM‑generated `suburbLat`/`suburbLng`; always use OSM‑derived coordinates.
  - Do **not** batch‑update version strings—bump once per shipped commit.
  - Do **not** let `worker/index.ts`'s `FREE_TIER_SYSTEM_PROMPT`/`buildFreeTierUserMessage` drift from `buildSystemPrompt`/`buildUserMessage` in `src/services/llm.ts` – they're duplicated (separate deploy targets) and must stay in sync so `parseReview` can handle both outputs identically.
  - Do **not** let `POST /llm/free` accept client‑supplied prompt text (system/userMessage) – only structured fields – or the shared key becomes a general‑purpose free LLM proxy.

---

## How to Proceed

When working on a new feature or bug fix:

1. **Read relevant files** (e.g., `src/services/osm.ts` for OSM grounding, `src/services/scoring.ts` for score calculation).  
2. **Create a task** using `TaskCreate` to outline steps.  
3. **Implement** changes, verify tests pass (`npm run test`), lint passes (`npm run lint`), and the build succeeds (`npm run build`).  
4. **Update version** if you introduced a breaking change or new feature.  
5. **Commit** with a message that includes the new version number.  

Follow the conventions above to keep the codebase consistent and the deployment pipeline smooth.
export interface Env {
  REVIEWS: KVNamespace
  ALLOWED_ORIGIN: string
  GEMINI_API_KEY: string
  OPENROUTER_API_KEY: string
}

const MAX_PAYLOAD_BYTES = 100_000   // 100 KB hard limit
const MAX_ANTHROPIC_PAYLOAD_BYTES = 150_000
const TTL_SECONDS = 60 * 60 * 24 * 365  // 1 year
const BENCHMARKS_KV_KEY = 'benchmarks:au'
const BENCHMARKS_TTL_SECONDS = 60 * 60 * 24 * 8  // 8 days (longer than weekly cron)

const FREE_TIER_MAX_PAYLOAD_BYTES = 20_000
const FREE_TIER_MODEL = 'openai/gpt-oss-20b:free'
// OpenRouter caps free models at 1000 req/day account-wide once $10+ credit has
// ever been added (50/day with zero credit). Global limit is kept a little
// under that ceiling so we return our own message instead of a generic
// upstream error; lower both again if the account ever drops back to zero credit.
const FREE_TIER_PER_IP_DAILY_LIMIT = 15
const FREE_TIER_GLOBAL_DAILY_LIMIT = 500
const RATE_LIMIT_TTL_SECONDS = 60 * 60 * 25  // 25h, covers a full UTC day plus buffer
const AU_STATE_CODES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA']

// Inline nanoid-style ID generator (no npm dependency needed)
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const nanoid = (size = 10): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  return Array.from(bytes).map((b) => ALPHABET[b % ALPHABET.length]).join('')
}

const resolveCorsOrigin = (request: Request, configuredOrigin = '*') => {
  const requestOrigin = request.headers.get('Origin')
  if (!requestOrigin || configuredOrigin === '*') return '*'

  const allowedOrigins = configuredOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
  const isLocalDev = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin)
  if (allowedOrigins.includes(requestOrigin) || isLocalDev) return requestOrigin

  return allowedOrigins[0] ?? '*'
}

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
})

const json = (data: unknown, status = 200, origin = '*') =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  })

// ── Benchmark prompt ──────────────────────────────────────────────────────────

const BENCHMARK_PROMPT = `You are an Australian property market data analyst.

Return the most recent available 12-month dwelling price growth and 5-year cumulative dwelling price growth for each Australian state and territory, based on the latest CoreLogic Home Value Index and PropTrack Home Price Index data you are aware of.

Use your most up-to-date training data. State clearly in the "source" field which index and approximate reporting period your figures are drawn from.

Return JSON only. No markdown fences. Exact shape required:

{
  "source": "PropTrack HPI [Month Year] / CoreLogic HVI [Month Year]",
  "states": {
    "NSW": { "annual12m": 6.5, "cumulative5yr": 32 },
    "VIC": { "annual12m": 2.5, "cumulative5yr": 18 },
    "QLD": { "annual12m": 17.5, "cumulative5yr": 65 },
    "SA":  { "annual12m": 13.9, "cumulative5yr": 58 },
    "WA":  { "annual12m": 21.5, "cumulative5yr": 72 },
    "TAS": { "annual12m": 3.5,  "cumulative5yr": 30 },
    "ACT": { "annual12m": 1.0,  "cumulative5yr": 22 },
    "NT":  { "annual12m": 16.9, "cumulative5yr": 40 }
  }
}

Rules:
- annual12m: percentage as a plain number (e.g. 6.5 means +6.5%)
- cumulative5yr: 5-year cumulative percentage as a plain number
- All 8 states/territories must be present
- No extra fields`

// ── Benchmark refresh via Gemini ──────────────────────────────────────────────

type BenchmarkPayload = {
  source: string
  states: Record<string, { annual12m: number; cumulative5yr: number }>
}

type AnthropicProxyPayload = {
  apiKey?: string
  model?: string
  system?: string
  userMessage?: string
  maxTokens?: number
  // Legacy: older client sends full prompt as single field
  prompt?: string
}

type FreeTierPayload = {
  suburb?: string
  state?: string
  homelyContext?: string
  osmContext?: string
}

// ── Free-tier review prompt ────────────────────────────────────────────────────
// Mirrors buildSystemPrompt/buildUserMessage in src/services/llm.ts. Duplicated
// (not imported) because this worker is a separate deploy target from the SPA.
// The /llm/free handler below builds the prompt itself from structured fields
// only - it never accepts client-supplied system/user text - so the shared
// OpenRouter key can only ever produce a Scouter suburb review, not an arbitrary
// chat completion.

const FREE_TIER_SYSTEM_PROMPT = `You are an Australian suburb research analyst.

Return JSON only. No markdown fences. Use 2026 context. Use AUD. No em dashes or en dashes - use a plain hyphen instead.

LEVEL values throughout: one of Low, Medium, High, Very High. Low = best for air/noise/risk fields.

For flight path (climate.noise.flightPath + flightPathLevel): use Airservices Australia as primary source. If status is uncertain or inconclusive, use Low and note the uncertainty in caveats. Do not declare no flight path impact unless explicitly supported.

NATURAL HAZARD RATING RUBRIC - apply objectively, not by impression:
- Bushfire:    Low = urban/minimal vegetation, BAL-LOW. Medium = leafy interface, BAL-12.5 to BAL-19. High = bushfire-prone area, BAL-29+. Very High = BAL-40 or Flame Zone.
- Flood:       Low = no flood zone, well-drained. Medium = near 1-in-100-year overlay or documented drainage issues. High = significant flood zone. Very High = high-risk floodplain.
- Storm/Hail:  Low = sheltered/inland. Medium = standard SE Australian exposure (Melbourne/Sydney/SE QLD baseline). High = known hail corridor. Very High = NT cyclone fringe or SE QLD hail belt core.
- Earthquake:  Low = standard eastern Australia (default for most VIC/NSW/QLD/SA/TAS). Medium = near known fault. High = active fault. Very High = high-risk seismic zone.
- Coastal Erosion: Omit unless coastal/tidal. Low = stable. Medium = some erosion history. High = active documented erosion.
- Landslide:   Omit unless notable topographic relief. Low = minor slopes. Medium = steep terrain, some slippage. High = known landslide history.

JSON shape:
{
  "exists": true,
  "suburb": string,
  "state": string,
  "postcode": string,
  "generatedAt": string,
  "summary": "Top-level practical assessment in 2-4 sentences.",
  "briefs": {
    "market": "One-sentence summary of market conditions (max ~120 chars).",
    "environment": "One-sentence summary of climate/air/noise (max ~120 chars).",
    "crime": "One-sentence summary of safety/insurance risk (max ~120 chars).",
    "infrastructure": "One-sentence summary of transit/amenity access (max ~120 chars)."
  },
  "notFoundReason": "Only present when exists is false.",
  "suggestedSuburb": "Only present when exists is false and a correction exists.",
  "suggestedState": "Only present when exists is false and a correction exists.",
  "marketNarrative": "Short market conditions paragraph.",
  "marketRows": [
    { "propertyType": "Houses", "medianPrice": string, "twelveMonthGrowth": "SUBURB-SPECIFIC estimate - not the state average. Use a range if uncertain, e.g. '+1% to +4%'.", "fiveYearGrowth": "SUBURB-SPECIFIC 5-year cumulative - not the state average.", "medianWeeklyRent": string, "grossYield": string },
    { "propertyType": "Units / Townhouses", "medianPrice": string, "twelveMonthGrowth": "SUBURB-SPECIFIC estimate.", "fiveYearGrowth": "SUBURB-SPECIFIC 5-year cumulative.", "medianWeeklyRent": string, "grossYield": string }
  ],
  "infrastructure": {
    "transit": "Train, bus, road and commute context.",
    "education": "Primary, secondary, tertiary and catchment notes.",
    "lifestyle": "Retail, dining, parks, health, culture, religious facilities and daily amenity.",
    "demographic": "Dominant resident profiles and census-style context.",
    "trainStations": [{ "name": string, "lines": string, "distanceKm": number }],
    "tramStops": "Tram stop availability description, or null.",
    "busAvailability": "One of: Excellent, Good, Limited, None",
    "majorRoads": [string],
    "cbdDistanceKm": number,
    "cbdCommuteMinutes": number,
    "suburbLat": number,
    "suburbLng": number,
    "primarySchools": number,
    "primarySchoolNames": ["Proper name only, e.g. 'Croydon Hills Primary School'. Up to 8."],
    "secondarySchools": number,
    "secondarySchoolNames": ["Proper name only, e.g. 'Oxley College'. Up to 8."],
    "shoppingPrecincts": number,
    "shoppingPrecinctNames": ["Proper name only, e.g. 'Eastland Shopping Centre'. Up to 8. Never use descriptions."],
    "parks": number,
    "parkNames": ["Proper name only, e.g. 'Warranwood Reserve'. Up to 8. No descriptions."],
    "medicalCentres": number,
    "medicalCentreNames": ["Proper name only, e.g. 'Croydon Medical Centre'. Up to 8. No descriptions."],
    "restaurants": number,
    "restaurantNames": ["Up to 8 well-known or notable restaurant or cafe names in the suburb. Proper name only, e.g. 'The Pines Restaurant'. Omit if none known."],
    "pointsOfInterest": [{ "icon": "single emoji character, e.g. 🏛️ 🎭 ⚽ 🏊", "label": string }]
  },
  "climate": {
    "summerAverages": "Average high and low temperatures plus seasonal behaviour.",
    "winterAverages": "Average high and low temperatures plus rainfall/cloud/frost behaviour.",
    "airQuality": {
      "overallRating": LEVEL,
      "overallSummary": "1-2 sentences on typical air quality and seasonal variation.",
      "particulateMatter": "PM2.5/PM10 levels, sources, health context.",
      "particulateMatterLevel": LEVEL,
      "ozone": "Ground-level ozone risk, seasonal peaks, health advisories.",
      "ozoneLevel": LEVEL,
      "pollen": "Pollen season severity, dominant species, allergy impact.",
      "pollenLevel": LEVEL,
      "industrialPollution": "Nearby pollution sources and air quality impact.",
      "industrialPollutionLevel": LEVEL
    },
    "noise": {
      "flightPath": "Airport, runway approach, overflight frequency and noise level.",
      "flightPathLevel": LEVEL,
      "railNoise": "Proximity to train/tram lines and noise impact.",
      "railNoiseLevel": LEVEL,
      "roadNoise": "Proximity to major roads/freeways and traffic noise.",
      "roadNoiseLevel": LEVEL,
      "industrialZones": "Nearby industrial/port zones and noise impact.",
      "industrialZonesLevel": LEVEL,
      "overallRating": LEVEL,
      "overallSummary": "1-2 sentences on overall noise and environmental amenity."
    },
    "wind": {
      "overallRating": LEVEL,
      "overallSummary": "1-2 sentences on wind exposure and seasonal patterns.",
      "predominantDirection": string,
      "averageSpeedKmh": number,
      "seasonalVariation": "How wind varies by season.",
      "directions": [{ "direction": string, "frequency": number, "avgSpeedKmh": number }]
    }
  },
  "crime": {
    "narrative": "Crime and safety analysis with LGA, incident types, and practical interpretation.",
    "insuranceImpact": "How crime and risk affect home, contents and car insurance. Mention theft rates, flood/fire risk, postcode loading.",
    "estimatedAnnualPremiums": { "homeBuilding": string, "homeContents": string, "carComprehensive": string },
    "crimeTypes": [{ "label": string, "level": LEVEL }],
    "naturalRisks": [{ "label": string, "level": LEVEL, "note": "1-sentence factual note." }]
  },
  "demographics": {
    "summary": "Census-style population and resident profile summary.",
    "population": string,
    "medianAge": string
  },
  "caveats": [string],
  "briefCaveats": [string],
  "references": ["Named source with URL where available. For ABS Census always include the year, e.g. 'ABS Census of Population and Housing 2021'."]
}

Notes:
- trainStations: list ALL stations within 4km of suburb centre. distanceKm = straight-line distance from suburb centre.
- pointsOfInterest: only include genuinely distinct landmarks not already captured by other named lists (e.g. sporting grounds, community centres, galleries, libraries, major attractions). Do NOT duplicate parks, schools, or shopping centres here. The "icon" field MUST be a single emoji character - never a word or text string.
- crimeTypes labels: Theft, Assault, Break & Enter, Vandalism, Drug offences, Vehicle theft.
`

const buildFreeTierUserMessage = (query: string, homelyContext?: string, osmContext?: string) => `Create a concise but useful suburb review for: ${query}.

If you cannot confidently identify the Australian location, return "exists": false, use the requested place/state in "suburb" and "state", explain the issue in "summary" and "notFoundReason", and return empty or brief placeholder values for the remaining fields. If there is a likely intended Australian suburb or town, include it in "suggestedSuburb" and its state abbreviation in "suggestedState". For example, if the request is "Warragul, TAS", set "suggestedSuburb": "Warragul" and "suggestedState": "VIC".
${osmContext ? `\nThe following infrastructure data was fetched live from OpenStreetMap for this suburb. Treat it as the authoritative ground truth for named infrastructure (roads, schools, parks, shops, medical centres). Use these exact names in the relevant fields (majorRoads, trainStations, primarySchoolNames, secondarySchoolNames, parkNames, shoppingPrecinctNames, medicalCentreNames). Do not invent names not present here:\n<osm_context>\n${osmContext}\n</osm_context>\n` : ''}${homelyContext ? `\nThe following is community-sourced context from Homely.com.au for this suburb. Use it to enrich the demographics and lifestyle sections where relevant, but treat it as anecdotal and supplement with your own knowledge:\n<homely_context>\n${homelyContext}\n</homely_context>\n` : ''}`

// Mirrors the acceptance check in src/services/reviewParser.ts's parseReview -
// used to decide whether a free-tier response is worth returning as-is or
// worth retrying. Deliberately permissive (a plain JSON.parse, no repair
// passes): the client's own resilient parser handles recoverable formatting
// issues, this only needs to catch a model dropping a whole required section.
const extractOpenRouterContent = (bodyText: string): string | undefined => {
  try {
    const payload = JSON.parse(bodyText) as { choices?: Array<{ message?: { content?: string } }> }
    return payload.choices?.[0]?.message?.content
  } catch {
    return undefined
  }
}

const isCompleteReviewContent = (content: string): boolean => {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    if (parsed.exists === false && parsed.summary) return true
    return Boolean(parsed.summary && Array.isArray(parsed.marketRows) && parsed.infrastructure && parsed.crime && parsed.climate)
  } catch {
    return false
  }
}

// Soft daily counters in the REVIEWS KV store. Not atomic (KV reads/writes can
// race under concurrent requests), which is fine here - this is abuse
// mitigation for a shared free key, not a precise billing enforcement.
const getRateLimitCount = async (env: Env, key: string): Promise<number> =>
  Number((await env.REVIEWS.get(key)) ?? '0')

const incrementRateLimit = async (env: Env, key: string, current: number): Promise<void> => {
  await env.REVIEWS.put(key, String(current + 1), { expirationTtl: RATE_LIMIT_TTL_SECONDS })
}

const refreshBenchmarks = async (env: Env): Promise<BenchmarkPayload | null> => {
  if (!env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set - cannot refresh benchmarks')
    return null
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: BENCHMARK_PROMPT }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json',
            maxOutputTokens: 512,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    )

    if (!res.ok) {
      console.error(`Gemini benchmark fetch failed: ${res.status}`)
      return null
    }

    const payload = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim()
    if (!text) return null

    const parsed = JSON.parse(text) as BenchmarkPayload

    // Validate shape - all 8 states must be present with numeric values
    const required = ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT']
    for (const state of required) {
      const entry = parsed.states?.[state]
      if (!entry || typeof entry.annual12m !== 'number' || typeof entry.cumulative5yr !== 'number') {
        console.error(`Benchmark validation failed: missing or invalid entry for ${state}`)
        return null
      }
    }

    return parsed
  } catch (err) {
    console.error('Benchmark refresh error:', err)
    return null
  }
}

// ── Fetch handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const allowedOrigin = resolveCorsOrigin(request, env.ALLOWED_ORIGIN)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(allowedOrigin) })
    }

    // GET /benchmarks - return cached benchmarks (or 503 if not yet populated)
    if (request.method === 'GET' && url.pathname === '/benchmarks') {
      const cached = await env.REVIEWS.get(BENCHMARKS_KV_KEY)
      if (!cached) {
        return json({ error: 'Benchmarks not yet available' }, 503, allowedOrigin)
      }
      return new Response(cached, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
          ...corsHeaders(allowedOrigin),
        },
      })
    }

    // POST /llm/anthropic - proxy Anthropic requests because their API blocks browser CORS.
    // The user-provided API key is only forwarded to Anthropic and is never stored.
    if (request.method === 'POST' && url.pathname === '/llm/anthropic') {
      const contentLength = Number(request.headers.get('Content-Length') ?? 0)
      if (contentLength > MAX_ANTHROPIC_PAYLOAD_BYTES) {
        return json({ error: 'Payload too large' }, 413, allowedOrigin)
      }

      let payload: AnthropicProxyPayload
      try {
        payload = await request.json() as AnthropicProxyPayload
      } catch {
        return json({ error: 'Invalid JSON' }, 400, allowedOrigin)
      }

      const hasNewFormat = payload.system && payload.userMessage
      const hasLegacyFormat = payload.prompt
      if (!payload.apiKey || !payload.model || (!hasNewFormat && !hasLegacyFormat)) {
        return json({ error: 'apiKey, model and (system+userMessage or prompt) are required' }, 400, allowedOrigin)
      }

      // Build the Anthropic request body.
      // New format: system is sent separately with cache_control so the large static
      // prompt prefix is cached across requests; only the per-suburb user message is fresh.
      // Legacy format: full prompt in messages (no caching benefit, backwards compat only).
      const anthropicBody = hasNewFormat
        ? {
            model: payload.model,
            temperature: 0.2,
            max_tokens: payload.maxTokens ?? 9000,
            system: [
              {
                type: 'text',
                text: payload.system,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [{ role: 'user', content: payload.userMessage }],
          }
        : {
            model: payload.model,
            temperature: 0.2,
            max_tokens: payload.maxTokens ?? 9000,
            messages: [{ role: 'user', content: payload.prompt }],
          }

      let anthropicRes: Response
      try {
        anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': payload.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(anthropicBody),
          signal: AbortSignal.timeout(55_000),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown upstream request error'
        return json({ error: `Anthropic upstream request failed: ${message}` }, 502, allowedOrigin)
      }

      return new Response(await anthropicRes.text(), {
        status: anthropicRes.status,
        headers: {
          'Content-Type': anthropicRes.headers.get('Content-Type') ?? 'application/json',
          ...corsHeaders(allowedOrigin),
        },
      })
    }

    // POST /llm/free - zero-config review generation using Scouter's own OpenRouter key.
    // Unlike /llm/anthropic, no api key or prompt text comes from the client: only
    // structured suburb/state/context fields are accepted, and the fixed prompt above
    // is what actually gets sent, so this endpoint can never be used as a general
    // free-form LLM proxy. Rate-limited per IP and globally to bound shared-key spend.
    if (request.method === 'POST' && url.pathname === '/llm/free') {
      if (!env.OPENROUTER_API_KEY) {
        return json({ error: 'Free tier is not configured' }, 503, allowedOrigin)
      }

      const contentLength = Number(request.headers.get('Content-Length') ?? 0)
      if (contentLength > FREE_TIER_MAX_PAYLOAD_BYTES) {
        return json({ error: 'Payload too large' }, 413, allowedOrigin)
      }

      let payload: FreeTierPayload
      try {
        payload = await request.json() as FreeTierPayload
      } catch {
        return json({ error: 'Invalid JSON' }, 400, allowedOrigin)
      }

      const suburb = (payload.suburb ?? '').trim().slice(0, 100)
      const state = (payload.state ?? '').trim().toUpperCase()
      if (!suburb || !AU_STATE_CODES.includes(state)) {
        return json({ error: 'suburb and a valid Australian state are required' }, 400, allowedOrigin)
      }
      const homelyContext = typeof payload.homelyContext === 'string' ? payload.homelyContext.slice(0, 2_500) : undefined
      const osmContext = typeof payload.osmContext === 'string' ? payload.osmContext.slice(0, 4_000) : undefined

      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      const today = new Date().toISOString().slice(0, 10)
      const globalKey = `ratelimit:free:global:${today}`
      const ipKey = `ratelimit:free:ip:${ip}:${today}`
      const [globalCount, ipCount] = await Promise.all([
        getRateLimitCount(env, globalKey),
        getRateLimitCount(env, ipKey),
      ])
      if (globalCount >= FREE_TIER_GLOBAL_DAILY_LIMIT) {
        return json({ error: "Scouter's free tier has reached its daily limit. Add your own API key in Settings to keep going." }, 429, allowedOrigin)
      }
      if (ipCount >= FREE_TIER_PER_IP_DAILY_LIMIT) {
        return json({ error: "You've reached today's free tier limit for this network. Add your own API key in Settings for unlimited use." }, 429, allowedOrigin)
      }
      await Promise.all([
        incrementRateLimit(env, globalKey, globalCount),
        incrementRateLimit(env, ipKey, ipCount),
      ])

      let bodyText = ''
      let upstreamStatus = 502
      let upstreamContentType = 'application/json'
      let lastError: unknown

      // Free-tier models occasionally drop a whole required section (e.g.
      // crime) under instruction-following limits. One retry happens here,
      // inside the single rate-limited request, rather than making the
      // client re-POST (which would burn a second charge against the daily
      // cap for what's really one logical review). Each attempt is wrapped
      // individually - a timeout/network failure on attempt 1 must not skip
      // attempt 2, only a genuine upstream error status does.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              'HTTP-Referer': 'https://scouter.mrated.dev',
              'X-Title': 'Scouter',
            },
            body: JSON.stringify({
              model: FREE_TIER_MODEL,
              temperature: 0.2,
              reasoning: { effort: 'low' },
              messages: [
                { role: 'system', content: FREE_TIER_SYSTEM_PROMPT },
                { role: 'user', content: buildFreeTierUserMessage(`${suburb}, ${state}`, homelyContext, osmContext) },
              ],
              response_format: { type: 'json_object' },
              max_tokens: 9000,
            }),
            signal: AbortSignal.timeout(35_000),
          })
          bodyText = await openRouterRes.text()
          upstreamStatus = openRouterRes.status
          upstreamContentType = openRouterRes.headers.get('Content-Type') ?? 'application/json'
          lastError = undefined

          if (!openRouterRes.ok) break  // upstream error status - retrying won't fix it
          const content = extractOpenRouterContent(bodyText)
          if (content && isCompleteReviewContent(content)) break
        } catch (err) {
          lastError = err  // timeout or network failure - let the loop try again if attempts remain
        }
      }

      if (lastError) {
        const message = lastError instanceof Error ? lastError.message : 'Unknown upstream request error'
        return json({ error: `OpenRouter upstream request failed: ${message}` }, 502, allowedOrigin)
      }

      return new Response(bodyText, {
        status: upstreamStatus,
        headers: {
          'Content-Type': upstreamContentType,
          ...corsHeaders(allowedOrigin),
        },
      })
    }

    // POST /reviews — store a new review, return { id }
    if (request.method === 'POST' && url.pathname === '/reviews') {
      const contentLength = Number(request.headers.get('Content-Length') ?? 0)
      if (contentLength > MAX_PAYLOAD_BYTES) {
        return json({ error: 'Payload too large' }, 413, allowedOrigin)
      }

      let body: string
      try {
        body = await request.text()
      } catch {
        return json({ error: 'Could not read request body' }, 400, allowedOrigin)
      }

      if (body.length > MAX_PAYLOAD_BYTES) {
        return json({ error: 'Payload too large' }, 413, allowedOrigin)
      }

      // Validate it is parseable JSON with the minimum shape we expect
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(body) as Record<string, unknown>
        if (!parsed.suburb || !parsed.state || !parsed.summary) {
          return json({ error: 'Invalid review shape' }, 400, allowedOrigin)
        }
      } catch {
        return json({ error: 'Invalid JSON' }, 400, allowedOrigin)
      }

      const id = nanoid(10)
      await env.REVIEWS.put(id, body, { expirationTtl: TTL_SECONDS })

      return json({ id }, 201, allowedOrigin)
    }

    // GET /reviews/:id — retrieve a stored review
    const getMatch = url.pathname.match(/^\/reviews\/([A-Za-z0-9_-]{6,20})$/)
    if (request.method === 'GET' && getMatch) {
      const id = getMatch[1]
      const value = await env.REVIEWS.get(id)
      if (!value) {
        return json({ error: 'Review not found' }, 404, allowedOrigin)
      }
      return new Response(value, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
          ...corsHeaders(allowedOrigin),
        },
      })
    }

    return json({ error: 'Not found' }, 404, allowedOrigin)
  },

  // ── Cron handler - runs weekly to refresh benchmark data ──────────────────
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('Benchmark cron: starting refresh')

    const benchmarks = await refreshBenchmarks(env)
    if (!benchmarks) {
      console.error('Benchmark cron: refresh failed, keeping existing cached value')
      return
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      source: benchmarks.source,
      states: benchmarks.states,
    }

    await env.REVIEWS.put(BENCHMARKS_KV_KEY, JSON.stringify(payload), {
      expirationTtl: BENCHMARKS_TTL_SECONDS,
    })

    console.log(`Benchmark cron: stored benchmarks (source: ${benchmarks.source})`)
  },
}

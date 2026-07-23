import type { LlmSettings, Review, StateBenchmarks } from '../types'
import { parseReview } from './reviewParser'
import { WORKER_BASE_URL } from './share'
import { splitLocation } from './location'

// 2min gives the free tier's worst case (two 35s upstream attempts, see
// worker/index.ts's /llm/free retry, plus Worker/KV overhead) real headroom
// before the client gives up first; paid providers normally respond in a
// few seconds regardless.
const REQUEST_TIMEOUT_MS = 120_000
const MAX_RETRIES = 3
const RETRY_BASE_MS = 1_200

const sleep = (ms: number) => new Promise<void>((res) => setTimeout(res, ms))

// Retries a fetch on 5xx responses (transient server errors like 503).
// Each attempt gets a fresh AbortSignal tied to the shared controller.
const fetchWithRetry = async (
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> => {
  let lastError: Error = new Error('Request failed')
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const res = await fetch(url, { ...init, signal })
    if (res.ok || res.status < 500) return res   // success or client error, do not retry
    const body = await res.text()
    lastError = new Error(`${res.status} ${body.slice(0, 260)}`)
    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_BASE_MS * (attempt + 1))
    }
  }
  throw lastError
}

const extractAzureResponseText = (payload: {
  output_text?: string
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
}) =>
  payload.output_text ??
  payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text' || item.type === 'text')?.text

const extractGeminiResponseText = (payload: {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}) => payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()

const extractAnthropicResponseText = (payload: {
  content?: Array<{ type?: string; text?: string }>
}) => payload.content?.find((part) => part.type === 'text')?.text?.trim()

export const friendlyRequestError = (caught: unknown) => {
  if (caught instanceof DOMException && caught.name === 'AbortError') {
    return `The LLM request timed out after ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds. Try a smaller/faster model or run the query again.`
  }
  if (caught instanceof TypeError && /fetch|network|failed/i.test(caught.message)) {
    return 'The browser could not reach the LLM provider. This is usually CORS or network blocking.'
  }
  return caught instanceof Error ? caught.message : 'Review generation failed.'
}

export const fetchHomelyContext = async (suburb: string, state: string): Promise<string> => {
  try {
    const slug = `${suburb.toLowerCase().replace(/\s+/g, '-')}-${state.toLowerCase()}`
    const url = `https://www.homely.com.au/suburb-profile/${slug}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return ''
    const html = await res.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const article = doc.querySelector('article')
    if (!article) return ''
    article.querySelectorAll('[class*="listing"], [class*="Listing"], [class*="property-card"]').forEach(el => el.remove())
    const raw = article.innerText ?? article.textContent ?? ''
    return raw.replace(/\s+/g, ' ').trim().slice(0, 2500)
  } catch {
    return ''
  }
}

// Static system instructions - identical across all requests, safe to cache.
export const buildSystemPrompt = () => `You are an Australian suburb research analyst.

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

// Per-suburb user message - varies per request (suburb name + optional context blocks).
export const buildUserMessage = (query: string, homelyContext?: string, osmContext?: string) => `Create a concise but useful suburb review for: ${query}.

If you cannot confidently identify the Australian location, return "exists": false, use the requested place/state in "suburb" and "state", explain the issue in "summary" and "notFoundReason", and return empty or brief placeholder values for the remaining fields. If there is a likely intended Australian suburb or town, include it in "suggestedSuburb" and its state abbreviation in "suggestedState". For example, if the request is "Warragul, TAS", set "suggestedSuburb": "Warragul" and "suggestedState": "VIC".
${osmContext ? `\nThe following infrastructure data was fetched live from OpenStreetMap for this suburb. Treat it as the authoritative ground truth for named infrastructure (roads, schools, parks, shops, medical centres). Use these exact names in the relevant fields (majorRoads, trainStations, primarySchoolNames, secondarySchoolNames, parkNames, shoppingPrecinctNames, medicalCentreNames). Do not invent names not present here:\n<osm_context>\n${osmContext}\n</osm_context>\n` : ''}${homelyContext ? `\nThe following is community-sourced context from Homely.com.au for this suburb. Use it to enrich the demographics and lifestyle sections where relevant, but treat it as anecdotal and supplement with your own knowledge:\n<homely_context>\n${homelyContext}\n</homely_context>\n` : ''}`

// Combined prompt for providers that don't support a separate system field (OpenAI-compatible).
export const buildPrompt = (query: string, homelyContext?: string, osmContext?: string) =>
  `${buildSystemPrompt()}\n\n${buildUserMessage(query, homelyContext, osmContext)}`

// OpenAI's own API expects max_completion_tokens (max_tokens is deprecated there);
// third-party OpenAI-compatible providers (DeepSeek, Kimi, OpenRouter, etc.)
// generally only support the older max_tokens field.
const openAiMaxTokensKey = (baseUrl: string): 'max_tokens' | 'max_completion_tokens' =>
  baseUrl.includes('api.openai.com') ? 'max_completion_tokens' : 'max_tokens'

export const callLlm = async (settings: LlmSettings, query: string, homelyContext?: string, liveBenchmarks?: StateBenchmarks, osmContext?: string): Promise<Review> => {
  const prompt = buildPrompt(query, homelyContext, osmContext)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    if (settings.provider === 'free') {
      const { place, state } = splitLocation(query)
      const response = await fetchWithRetry(
        `${WORKER_BASE_URL}/llm/free`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ suburb: place || query, state: state ?? '', homelyContext, osmContext }),
        },
        controller.signal,
      )
      const rawPayload = await response.text()
      if (!response.ok) {
        // The worker returns { error } for validation/rate-limit failures; fall
        // back to the raw body if it's not JSON (e.g. an upstream 5xx).
        let message = `Free tier request failed: ${response.status} ${rawPayload.slice(0, 260)}`
        try {
          const errorPayload = JSON.parse(rawPayload) as { error?: string }
          if (errorPayload.error) message = errorPayload.error
        } catch {
          // rawPayload wasn't JSON - keep the generic message above
        }
        throw new Error(message)
      }
      const payload = JSON.parse(rawPayload) as { choices?: Array<{ message?: { content?: string } }> }
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new Error('Free tier provider returned no review content.')
      return parseReview(content, liveBenchmarks)
    }

    if (settings.provider === 'azure') {
      if (!settings.azureEndpoint || !settings.azureDeployment || !settings.azureApiKey) {
        throw new Error('Azure endpoint, deployment and API key are required.')
      }
      const response = await fetchWithRetry(
        `${settings.azureEndpoint.replace(/\/$/, '')}/openai/responses?api-version=${settings.azureApiVersion}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': settings.azureApiKey },
          body: JSON.stringify({
            model: settings.azureDeployment,
            input: [{ role: 'user', content: prompt }],
            text: { format: { type: 'json_object' }, verbosity: 'low' },
            reasoning: { effort: 'low' },
            max_output_tokens: 9000,
          }),
        },
        controller.signal,
      )
      const rawPayload = await response.text()
      if (!response.ok) throw new Error(`Azure request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      const payload = JSON.parse(rawPayload) as {
        output_text?: string
        output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
      }
      const content = extractAzureResponseText(payload)
      if (!content) throw new Error('Azure returned no review content.')
      return parseReview(content, liveBenchmarks)
    }

    if (settings.provider === 'gemini') {
      if (!settings.geminiApiKey || !settings.geminiModel) {
        throw new Error('Gemini API key and model are required.')
      }
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`

      const sendGeminiRequest = (enableSearchTool: boolean) => fetchWithRetry(
        geminiUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 9000 },
            ...(enableSearchTool ? { tools: [{ google_search: {} }] } : {}),
          }),
        },
        controller.signal,
      )

      let response = await sendGeminiRequest(true)
      let rawPayload = await response.text()

      // Some models/endpoints do not support tools; gracefully retry without grounding.
      if (!response.ok && (response.status === 400 || response.status === 404)) {
        const unsupportedTools = /tools?|google_search|ground/i.test(rawPayload)
        if (unsupportedTools) {
          response = await sendGeminiRequest(false)
          rawPayload = await response.text()
        }
      }

      if (!response.ok) throw new Error(`Gemini request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      const payload = JSON.parse(rawPayload) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      const content = extractGeminiResponseText(payload)
      if (!content) throw new Error('Gemini returned no review content.')
      return parseReview(content, liveBenchmarks)
    }

    if (settings.provider === 'anthropic') {
      if (!settings.anthropicApiKey || !settings.anthropicModel) {
        throw new Error('Anthropic API key and model are required.')
      }
      const response = await fetchWithRetry(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: settings.anthropicModel,
            max_tokens: 9000,
            system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: buildUserMessage(query, homelyContext, osmContext) }],
          }),
        },
        controller.signal,
      )
      const rawPayload = await response.text()
      if (!response.ok) throw new Error(`Anthropic request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      const payload = JSON.parse(rawPayload) as { content?: Array<{ type?: string; text?: string }> }
      const content = extractAnthropicResponseText(payload)
      if (!content) throw new Error('Anthropic returned no review content.')
      return parseReview(content, liveBenchmarks)
    }

    if (!settings.openAiApiKey || !settings.openAiModel) {
      throw new Error('OpenAI-compatible API key and model are required.')
    }
    const response = await fetchWithRetry(
      `${settings.openAiBaseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.openAiApiKey}` },
        body: JSON.stringify({
          model: settings.openAiModel,
          temperature: 0.2,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          [openAiMaxTokensKey(settings.openAiBaseUrl)]: 9000,
        }),
      },
      controller.signal,
    )
    const rawPayload = await response.text()
    if (!response.ok) throw new Error(`OpenAI-compatible request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
    const payload = JSON.parse(rawPayload) as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('Provider returned no review content.')
    return parseReview(content, liveBenchmarks)
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export type LlmTestResult =
  | { ok: true; reply: string; durationMs: number }
  | { ok: false; error: string; durationMs: number }

const TEST_PROMPT = 'Reply with just the single word "Hello" and nothing else.'
const TEST_TIMEOUT_MS = 20_000

/**
 * Fires a minimal, cheap request at the configured provider to confirm the
 * endpoint/model/key combination actually works, without going through the
 * full review prompt or JSON parsing. Times the round trip for display.
 */
export const testLlmConnection = async (settings: LlmSettings): Promise<LlmTestResult> => {
  const start = performance.now()
  const result = await testLlmConnectionInner(settings)
  const durationMs = Math.round(performance.now() - start)
  return { ...result, durationMs }
}

const testLlmConnectionInner = async (
  settings: LlmSettings,
): Promise<{ ok: true; reply: string } | { ok: false; error: string }> => {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), TEST_TIMEOUT_MS)

  try {
    if (settings.provider === 'free') {
      return { ok: true, reply: 'No setup needed - the free tier is ready to use.' }
    }

    if (settings.provider === 'azure') {
      if (!settings.azureEndpoint || !settings.azureDeployment || !settings.azureApiKey) {
        return { ok: false, error: 'Azure endpoint, deployment and API key are required.' }
      }
      const response = await fetch(
        `${settings.azureEndpoint.replace(/\/$/, '')}/openai/responses?api-version=${settings.azureApiVersion}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': settings.azureApiKey },
          body: JSON.stringify({
            model: settings.azureDeployment,
            input: [{ role: 'user', content: TEST_PROMPT }],
            max_output_tokens: 20,
          }),
          signal: controller.signal,
        },
      )
      const rawPayload = await response.text()
      if (!response.ok) return { ok: false, error: `${response.status} ${rawPayload.slice(0, 200)}` }
      const payload = JSON.parse(rawPayload) as {
        output_text?: string
        output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
      }
      const content = extractAzureResponseText(payload)
      return content ? { ok: true, reply: content.trim() } : { ok: false, error: 'Azure returned no content.' }
    }

    if (settings.provider === 'gemini') {
      if (!settings.geminiApiKey || !settings.geminiModel) {
        return { ok: false, error: 'Gemini API key and model are required.' }
      }
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: TEST_PROMPT }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 20 },
          }),
          signal: controller.signal,
        },
      )
      const rawPayload = await response.text()
      if (!response.ok) return { ok: false, error: `${response.status} ${rawPayload.slice(0, 200)}` }
      const payload = JSON.parse(rawPayload) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      const content = extractGeminiResponseText(payload)
      return content ? { ok: true, reply: content.trim() } : { ok: false, error: 'Gemini returned no content.' }
    }

    if (settings.provider === 'anthropic') {
      if (!settings.anthropicApiKey || !settings.anthropicModel) {
        return { ok: false, error: 'Anthropic API key and model are required.' }
      }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': settings.anthropicApiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: settings.anthropicModel,
          max_tokens: 20,
          messages: [{ role: 'user', content: TEST_PROMPT }],
        }),
        signal: controller.signal,
      })
      const rawPayload = await response.text()
      if (!response.ok) return { ok: false, error: `${response.status} ${rawPayload.slice(0, 200)}` }
      const payload = JSON.parse(rawPayload) as { content?: Array<{ type?: string; text?: string }> }
      const content = extractAnthropicResponseText(payload)
      return content ? { ok: true, reply: content.trim() } : { ok: false, error: 'Anthropic returned no content.' }
    }

    if (!settings.openAiApiKey || !settings.openAiModel) {
      return { ok: false, error: 'OpenAI-compatible API key and model are required.' }
    }
    const response = await fetch(`${settings.openAiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.openAiApiKey}` },
      body: JSON.stringify({
        model: settings.openAiModel,
        temperature: 0,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        [openAiMaxTokensKey(settings.openAiBaseUrl)]: 20,
      }),
      signal: controller.signal,
    })
    const rawPayload = await response.text()
    if (!response.ok) return { ok: false, error: `${response.status} ${rawPayload.slice(0, 200)}` }
    const payload = JSON.parse(rawPayload) as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    return content ? { ok: true, reply: content.trim() } : { ok: false, error: 'Provider returned no content.' }
  } catch (caught) {
    return { ok: false, error: friendlyRequestError(caught) }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

/**
 * Fetch cached property benchmarks from the Worker KV store.
 * Returns null if unavailable - callers should fall back to hardcoded constants.
 */
export const fetchBenchmarks = async (): Promise<StateBenchmarks | null> => {
  try {
    const res = await fetch(`${WORKER_BASE_URL}/benchmarks`, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return null
    return (await res.json()) as StateBenchmarks
  } catch {
    return null
  }
}

import type { LlmSettings, Review, StateBenchmarks } from '../types'
import { parseReview } from './reviewParser'
import { WORKER_BASE_URL } from './share'

const REQUEST_TIMEOUT_MS = 60_000
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
    return 'The LLM request timed out after 60 seconds. Try a smaller/faster model or run the query again.'
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

export const buildPrompt = (query: string, homelyContext?: string) => `You are an Australian suburb research analyst.

Create a concise but useful suburb review for: ${query}.

If you cannot confidently identify the Australian location, return "exists": false, use the requested place/state in "suburb" and "state", explain the issue in "summary" and "notFoundReason", and return empty or brief placeholder values for the remaining fields. If there is a likely intended Australian suburb or town, include it in "suggestedSuburb" and its state abbreviation in "suggestedState". For example, if the request is "Warragul, TAS", set "suggestedSuburb": "Warragul" and "suggestedState": "VIC".
${homelyContext ? `\nThe following is community-sourced context from Homely.com.au for this suburb. Use it to enrich the demographics and lifestyle sections where relevant, but treat it as anecdotal and supplement with your own knowledge:\n<homely_context>\n${homelyContext}\n</homely_context>\n` : ''}
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
    "secondarySchools": number,
    "shoppingPrecincts": number,
    "parks": number,
    "medicalCentres": number,
    "pointsOfInterest": [{ "icon": string, "label": string }]
  },
  "demographics": {
    "summary": "Census-style population and resident profile summary.",
    "population": string,
    "medianAge": string,
    "ageGroups": [{ "label": string, "value": number }],
    "householdTypes": [{ "label": string, "value": number }],
    "tenureTypes": [{ "label": string, "value": number }],
    "countryOfOrigin": [{ "label": string, "value": number }],
    "residentProfiles": [{ "label": string, "value": number }],
    "religion": [{ "label": string, "value": number }]
  },
  "caveats": [string],
  "briefCaveats": [string],
  "references": ["Named source with URL where available. For ABS Census always include the year, e.g. 'ABS Census of Population and Housing 2021'."]
}

Notes:
- trainStations: list ALL stations within 4km of suburb centre. distanceKm = straight-line distance from suburb centre.
- crimeTypes labels: Theft, Assault, Break & Enter, Vandalism, Drug offences, Vehicle theft.
- demographics arrays must use these exact labels - ageGroups: 0-14, 15-24, 25-44, 45-64, 65+. householdTypes: Family households, Single-person households, Group households. tenureTypes: Owned outright, Mortgage, Rented.
`

export const callLlm = async (settings: LlmSettings, query: string, homelyContext?: string, liveBenchmarks?: StateBenchmarks): Promise<Review> => {
  const prompt = buildPrompt(query, homelyContext)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
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
            max_output_tokens: 7000,
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
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 7000 },
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
          },
          body: JSON.stringify({
            model: settings.anthropicModel,
            temperature: 0.2,
            max_tokens: 7000,
            messages: [{ role: 'user', content: prompt }],
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

    if (settings.provider === 'deepseek') {
      if (!settings.deepseekApiKey || !settings.deepseekModel) {
        throw new Error('DeepSeek API key and model are required.')
      }
      const response = await fetchWithRetry(
        'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.deepseekApiKey}` },
          body: JSON.stringify({
            model: settings.deepseekModel,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
            max_tokens: 7000,
          }),
        },
        controller.signal,
      )
      const rawPayload = await response.text()
      if (!response.ok) throw new Error(`DeepSeek request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      const payload = JSON.parse(rawPayload) as { choices?: Array<{ message?: { content?: string } }> }
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new Error('DeepSeek returned no review content.')
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
          max_completion_tokens: 7000,
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

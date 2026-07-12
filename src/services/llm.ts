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

If you cannot confidently identify the Australian location, return "exists": false, use the requested place/state in "suburb" and "state", explain the issue in "summary" and "notFoundReason", and return empty or brief placeholder values for the remaining fields. If there is a likely intended Australian suburb or town, include it in "suggestedSuburb" and include its Australian state or territory abbreviation in "suggestedState". For example, if the request is "Warragul, TAS", explain that it appears to correspond to Warragul, VIC, and set "suggestedSuburb": "Warragul" and "suggestedState": "VIC".
${homelyContext ? `\nThe following is community-sourced context from Homely.com.au for this suburb. Use it to enrich the demographics and lifestyle sections where relevant, but treat it as anecdotal and supplement with your own knowledge:\n<homely_context>\n${homelyContext}\n</homely_context>\n` : ''}
Return JSON only. Do not include markdown fences. Use current 2026 context where possible. Use AUD for money. Do not use em dashes or en dashes anywhere in the JSON output. Use a plain hyphen (-) instead of any dash character in price ranges and text.
For flight path assessment in climate.noise.flightPath and climate.noise.flightPathLevel, source flight path information from Airservices Australia first: https://aircraftnoise.airservicesaustralia.com/category/what-are-the-flight-paths-in-my-area/. Do not state that a suburb is not under a flight path unless this is explicitly supported by that source. If this source is unavailable or unclear for the suburb, say so explicitly in caveats and use a conservative uncertainty statement instead of declaring no flight path impact.

NATURAL HAZARD RATING RUBRIC - apply these criteria consistently across all suburbs. Each rating must reflect an objective, verifiable characteristic, not a subjective impression:
- Bushfire:    Low = urban area with minimal vegetation interface, BAL-LOW or no designation. Medium = leafy suburban interface or bushland proximity, BAL-12.5 to BAL-19 likely on some blocks. High = in or adjacent to a designated bushfire-prone area, BAL-29+. Very High = BAL-40 or Flame Zone.
- Flood:       Low = no mapped flood zone, no significant waterway proximity, well-drained. Medium = within or near a 1-in-100-year flood overlay, or local drainage issues documented. High = significant portion of suburb in a flood zone or frequently inundated. Very High = high-risk floodplain with regular inundation.
- Storm/Hail:  Low = sheltered or inland region, low severe storm frequency. Medium = standard southeastern Australian exposure (Melbourne, Sydney, SE QLD baseline - most suburbs). High = known hail corridor or high-frequency severe storm region. Very High = extreme exposure (NT cyclone fringe, SE QLD hail belt core).
- Earthquake:  Low = standard eastern Australia low-seismic zone (default for most of VIC, NSW, QLD, SA, TAS). Medium = near a known fault or moderate-seismic region. High = active fault zone. Very High = high-risk seismic zone.
- Coastal Erosion: Omit unless the suburb is coastal or tidal. Low = stable coastline. Medium = some erosion history. High = active documented erosion.
- Landslide:   Omit unless the suburb has notable topographic relief. Low = minor slopes, no documented instability. Medium = steep terrain with some documented slippage. High = known landslide history or formal geotechnical designation.

AUTHORITATIVE BENCHMARK DATA (PropTrack HPI, April 2026 - use these exact figures ONLY for the stateMedianGrowth, capitalCityGrowth, stateMedianGrowth5yr, capitalCityGrowth5yr display fields. Do NOT copy these into marketRows - marketRows must contain suburb-specific estimates, not state averages):
State | 12-month annual growth | 5-year cumulative growth
NSW   | +6.5%                  | +32% cumulative
VIC   | +2.5%                  | +18% cumulative
QLD   | +17.5%                 | +65% cumulative
SA    | +13.9%                 | +58% cumulative
WA    | +21.5%                 | +72% cumulative
TAS   | +3.5%                  | +30% cumulative
ACT   | +1.0%                  | +22% cumulative
NT    | +16.9%                 | +40% cumulative

JSON shape:
{
  "exists": true,
  "suburb": "Suburb name",
  "state": "State abbreviation",
  "postcode": "4-digit Australian postcode",
  "generatedAt": "ISO timestamp",
  "summary": "Top-level practical assessment in 2-4 sentences.",
  "briefs": {
    "market": "One-sentence summary of market conditions (max ~120 chars).",
    "environment": "One-sentence summary of climate/air/noise (max ~120 chars).",
    "crime": "One-sentence summary of safety/insurance risk (max ~120 chars).",
    "infrastructure": "One-sentence summary of transit/amenity access (max ~120 chars)."
  },
  "notFoundReason": "Only present when exists is false.",
  "suggestedSuburb": "Likely intended suburb or town. Only present when exists is false and a likely correction exists.",
  "suggestedState": "Likely intended Australian state or territory abbreviation. Only present when exists is false and a likely correction exists.",
  "marketNarrative": "Short market conditions paragraph.",
  "marketRows": [
    { "propertyType": "Houses", "medianPrice": "AUD $...", "twelveMonthGrowth": "SUBURB-SPECIFIC estimate from your knowledge of this suburb's local sales data - NOT the state benchmark figure. Express as a range if uncertain, e.g. '+1% to +4%'.", "fiveYearGrowth": "SUBURB-SPECIFIC 5-year cumulative estimate for this suburb - NOT the state benchmark. E.g. '+12% to +22%'.", "medianWeeklyRent": "AUD $...", "grossYield": "...%" },
    { "propertyType": "Units / Townhouses", "medianPrice": "AUD $...", "twelveMonthGrowth": "SUBURB-SPECIFIC estimate - NOT the state benchmark.", "fiveYearGrowth": "SUBURB-SPECIFIC 5-year estimate - NOT the state benchmark.", "medianWeeklyRent": "AUD $...", "grossYield": "...%" }
  ],
  "stateMedianGrowth": "BENCHMARK DISPLAY ONLY - use the exact 12-month figure from the AUTHORITATIVE BENCHMARK DATA table above for the suburb's state. E.g. '+2.5%'. Do not use this figure in marketRows.",
  "capitalCityGrowth": "BENCHMARK DISPLAY ONLY - use the exact 12-month figure from the AUTHORITATIVE BENCHMARK DATA table above. Prefix with the capital city name, e.g. 'Greater Melbourne +2.5%'. For ACT use 'Greater Canberra'; for NT use 'Greater Darwin'; for TAS use 'Greater Hobart'. Do not use this figure in marketRows.",
  "stateMedianGrowth5yr": "BENCHMARK DISPLAY ONLY - use the exact 5-year cumulative figure from the AUTHORITATIVE BENCHMARK DATA table above for the suburb's state, e.g. '+18% cumulative'. Do not use this figure in marketRows.",
  "capitalCityGrowth5yr": "BENCHMARK DISPLAY ONLY - use the exact 5-year cumulative figure from the AUTHORITATIVE BENCHMARK DATA table above. Prefix with the capital city name, e.g. 'Greater Melbourne +18% cumulative'. Do not use this figure in marketRows.",
  "climate": {
    "summerAverages": "Average high and low temperatures plus seasonal behaviour.",
    "winterAverages": "Average high and low temperatures plus rainfall/cloud/frost behaviour.",
    "airQuality": {
      "overallRating": "One of: Low, Medium, High, Very High (Low = cleanest)",
      "overallSummary": "1-2 sentence summary of the suburb's typical air quality and any seasonal variation.",
      "particulateMatter": "Typical PM2.5/PM10 levels, sources (traffic, industry, bushfire smoke) and health context.",
      "particulateMatterLevel": "One of: Low, Medium, High, Very High",
      "ozone": "Ground-level ozone risk, seasonal peaks, and any health advisories.",
      "ozoneLevel": "One of: Low, Medium, High, Very High",
      "pollen": "Pollen season severity, dominant plant species, and impact on allergy sufferers.",
      "pollenLevel": "One of: Low, Medium, High, Very High",
      "industrialPollution": "Nearby industrial or traffic pollution sources and their impact on air quality.",
      "industrialPollutionLevel": "One of: Low, Medium, High, Very High"
    },
    "noise": {
      "flightPath": "Is the suburb under a flight path? Use Airservices Australia flight path data first, then state which airport, runway approach, frequency of overflights, and estimated noise level.",
      "flightPathLevel": "One of: Low, Medium, High, Very High. If flight path status is uncertain, do not use Low; use Medium and state uncertainty in caveats.",
      "railNoise": "Proximity to train or tram lines and resulting noise impact on residents.",
      "railNoiseLevel": "One of: Low, Medium, High, Very High",
      "roadNoise": "Proximity to major roads, freeways or arterials and traffic noise impact.",
      "roadNoiseLevel": "One of: Low, Medium, High, Very High",
      "industrialZones": "Nearby industrial, port, or manufacturing zones and any associated noise or air quality impact.",
      "industrialZonesLevel": "One of: Low, Medium, High, Very High",
      "overallRating": "One of: Low, Medium, High, Very High",
      "overallSummary": "1-2 sentence summary of the suburb's overall noise and environmental amenity."
    },
    "wind": {
      "overallRating": "One of: Low, Medium, High, Very High (Low = calm/sheltered, Very High = frequently windy/exposed)",
      "overallSummary": "1-2 sentences describing the suburb's typical wind exposure and any notable seasonal patterns.",
      "predominantDirection": "The most common wind direction, e.g. 'North-westerly'.",
      "averageSpeedKmh": 15,
      "seasonalVariation": "Description of how wind varies by season, including any strong wind events.",
      "directions": [
        { "direction": "N",  "frequency": 12, "avgSpeedKmh": 14 },
        { "direction": "NE", "frequency": 8,  "avgSpeedKmh": 12 },
        { "direction": "E",  "frequency": 10, "avgSpeedKmh": 11 },
        { "direction": "SE", "frequency": 9,  "avgSpeedKmh": 13 },
        { "direction": "S",  "frequency": 11, "avgSpeedKmh": 15 },
        { "direction": "SW", "frequency": 18, "avgSpeedKmh": 20 },
        { "direction": "W",  "frequency": 20, "avgSpeedKmh": 22 },
        { "direction": "NW", "frequency": 12, "avgSpeedKmh": 16 }
      ]
    }
  },
  "crime": {
    "narrative": "Crime and safety analysis with LGA, common incident types, and practical safety interpretation.",
    "insuranceImpact": "How crime and risk levels affect home, contents and car insurance in this suburb. Mention relevant factors like theft rates, flood/fire risk, and postcode loading.",
    "estimatedAnnualPremiums": {
      "homeBuilding": "AUD $X,XXX - $X,XXX",
      "homeContents": "AUD $XXX - $X,XXX",
      "carComprehensive": "AUD $XXX - $X,XXX"
    },
    "crimeTypes": [
      { "label": "Theft", "level": "Medium" },
      { "label": "Assault", "level": "Low" },
      { "label": "Break & Enter", "level": "Low" },
      { "label": "Vandalism", "level": "Medium" },
      { "label": "Drug offences", "level": "Low" },
      { "label": "Vehicle theft", "level": "Medium" }
    ],
    "naturalRisks": [
      { "label": "Bushfire", "level": "Low", "note": "1-sentence factual note citing BAL zone, vegetation interface, or planning overlay." },
      { "label": "Flood", "level": "Medium", "note": "1-sentence factual note citing flood mapping, waterway proximity, or drainage issues." },
      { "label": "Storm/Hail", "level": "Medium", "note": "1-sentence factual note on storm frequency or hail exposure for the region." },
      { "label": "Earthquake", "level": "Low", "note": "1-sentence factual note on seismic zone classification." },
      { "label": "Coastal Erosion", "level": "Low", "note": "Include only if the suburb is coastal or near tidal waterways. Omit otherwise." },
      { "label": "Landslide", "level": "Low", "note": "Include only if the suburb has notable topographic relief or instability. Omit otherwise." }
    ]
  },
  "infrastructure": {
    "transit": "Train, bus, road and commute context.",
    "education": "Primary, secondary, tertiary and catchment notes.",
    "lifestyle": "Retail, dining, parks, health, culture, religious facilities (churches, mosques, temples, synagogues etc.) and daily amenity.",
    "demographic": "Dominant resident profiles and census-style context.",
    "trainStations": [{ "name": "Station name", "lines": "Line name(s)" }],
    "tramStops": "Description of tram stop availability, or null if not applicable.",
    "busAvailability": "One of: Excellent, Good, Limited, None",
    "majorRoads": ["Nearest freeway or arterial road name and approximate distance"],
    "cbdDistanceKm": 12,
    "cbdCommuteMinutes": 25,
    "suburbLat": -37.123,
    "suburbLng": 144.456,
    "primarySchools": 3,
    "secondarySchools": 1,
    "shoppingPrecincts": 2,
    "parks": 5,
    "medicalCentres": 2,
    "pointsOfInterest": [
      { "icon": "🏛", "label": "Notable landmark or facility name" },
      { "icon": "⛪", "label": "Church / mosque / temple name if notable" }
    ]
  },
  "demographics": {
    "summary": "Census-style population and resident profile summary.",
    "population": "Approximate population if known.",
    "medianAge": "Approximate median age if known.",
    "ageGroups": [
      { "label": "0-14", "value": 18 },
      { "label": "15-24", "value": 12 },
      { "label": "25-44", "value": 31 },
      { "label": "45-64", "value": 24 },
      { "label": "65+", "value": 15 }
    ],
    "householdTypes": [
      { "label": "Family households", "value": 68 },
      { "label": "Single-person households", "value": 24 },
      { "label": "Group households", "value": 8 }
    ],
    "tenureTypes": [
      { "label": "Owned outright", "value": 32 },
      { "label": "Mortgage", "value": 38 },
      { "label": "Rented", "value": 30 }
    ],
    "countryOfOrigin": [
      { "label": "Australia", "value": 68 },
      { "label": "England", "value": 5 },
      { "label": "India", "value": 4 },
      { "label": "China", "value": 3 },
      { "label": "Other", "value": 20 }
    ],
    "residentProfiles": [
      { "label": "Families", "value": 35 },
      { "label": "Professionals", "value": 25 },
      { "label": "Retirees / Elderly", "value": 15 },
      { "label": "Students", "value": 10 },
      { "label": "Singles", "value": 10 },
      { "label": "Other", "value": 5 }
    ],
    "religion": [
      { "label": "No religion", "value": 38 },
      { "label": "Catholic", "value": 20 },
      { "label": "Anglican", "value": 10 },
      { "label": "Islam", "value": 5 },
      { "label": "Buddhism", "value": 4 },
      { "label": "Hinduism", "value": 3 },
      { "label": "Other Christian", "value": 10 },
      { "label": "Other", "value": 10 }
    ]
  },
  "caveats": ["Any uncertainty, unavailable fresh data, or source limitation."],
  "briefCaveats": ["Short one-line caveat statements suitable for compact UI."],
  "references": ["Named data source, publication, or public agency used or recommended for verification, including a URL when available."]
}

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
            max_output_tokens: 12000,
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
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 12000 },
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
            max_tokens: 12000,
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
            max_tokens: 12000,
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
          max_completion_tokens: 12000,
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

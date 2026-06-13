import type { LlmSettings, Review } from '../types'
import { parseReview } from './reviewParser'

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
    if (res.ok || res.status < 500) return res   // success or client error — don't retry
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
Return JSON only. Do not include markdown fences. Use current 2026 context where possible. Use AUD for money. Do not use em dashes.

JSON shape:
{
  "exists": true,
  "suburb": "Suburb name",
  "state": "State abbreviation",
  "postcode": "4-digit Australian postcode",
  "generatedAt": "ISO timestamp",
  "summary": "Top-level practical assessment in 2-4 sentences.",
  "notFoundReason": "Only present when exists is false.",
  "suggestedSuburb": "Likely intended suburb or town. Only present when exists is false and a likely correction exists.",
  "suggestedState": "Likely intended Australian state or territory abbreviation. Only present when exists is false and a likely correction exists.",
  "marketNarrative": "Short market conditions paragraph.",
  "marketRows": [
    { "propertyType": "Houses", "medianPrice": "AUD $...", "twelveMonthGrowth": "+...%", "medianWeeklyRent": "AUD $...", "grossYield": "...%" },
    { "propertyType": "Units / Townhouses", "medianPrice": "AUD $...", "twelveMonthGrowth": "...%", "medianWeeklyRent": "AUD $...", "grossYield": "...%" }
  ],
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
      "flightPath": "Is the suburb under a flight path? Which airport, which runway approach, frequency of overflights, and estimated noise level.",
      "flightPathLevel": "One of: Low, Medium, High, Very High",
      "railNoise": "Proximity to train or tram lines and resulting noise impact on residents.",
      "railNoiseLevel": "One of: Low, Medium, High, Very High",
      "roadNoise": "Proximity to major roads, freeways or arterials and traffic noise impact.",
      "roadNoiseLevel": "One of: Low, Medium, High, Very High",
      "industrialZones": "Nearby industrial, port, or manufacturing zones and any associated noise or air quality impact.",
      "industrialZonesLevel": "One of: Low, Medium, High, Very High",
      "overallRating": "One of: Low, Medium, High, Very High",
      "overallSummary": "1-2 sentence summary of the suburb's overall noise and environmental amenity."
    }
  },
  "crime": {
    "narrative": "Crime and safety analysis with LGA, common incident types, and practical safety interpretation.",
    "insuranceImpact": "How crime and risk levels affect home, contents and car insurance in this suburb. Mention relevant factors like theft rates, flood/fire risk, and postcode loading.",
    "estimatedAnnualPremiums": {
      "homeBuilding": "AUD $X,XXX – $X,XXX",
      "homeContents": "AUD $XXX – $X,XXX",
      "carComprehensive": "AUD $XXX – $X,XXX"
    },
    "crimeTypes": [
      { "label": "Theft", "level": "Medium" },
      { "label": "Assault", "level": "Low" },
      { "label": "Break & Enter", "level": "Low" },
      { "label": "Vandalism", "level": "Medium" },
      { "label": "Drug offences", "level": "Low" },
      { "label": "Vehicle theft", "level": "Medium" }
    ]
  },
  "infrastructure": {
    "transit": "Train, bus, road and commute context.",
    "education": "Primary, secondary, tertiary and catchment notes.",
    "lifestyle": "Retail, dining, parks, health, culture and daily amenity.",
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
      { "icon": "🏛", "label": "Notable landmark or facility name" }
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
    ]
  },
  "scores": {
    "overall": 7,
    "property": 7,
    "safety": 8,
    "infrastructure": 7,
    "demographics": 6,
    "environment": 8
  },
  "caveats": ["Any uncertainty, unavailable fresh data, or source limitation."],
  "references": ["Named data source, publication, or public agency used or recommended for verification, including a URL when available."]
}

Scoring guide (integer 1–10, higher = better for liveability):
- overall: weighted composite of the five category scores
- property: value for money, growth prospects, rental yield quality
- safety: low crime, low insurance loading, community safety feel
- infrastructure: transit access, schools, amenities, CBD connectivity
- demographics: community diversity, stability, age mix suitability
- environment: air quality, noise, green space, climate liveability`

export const callLlm = async (settings: LlmSettings, query: string, homelyContext?: string): Promise<Review> => {
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
            max_output_tokens: 4000,
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
      return parseReview(content)
    }

    if (settings.provider === 'gemini') {
      if (!settings.geminiApiKey || !settings.geminiModel) {
        throw new Error('Gemini API key and model are required.')
      }
      const response = await fetchWithRetry(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 4000 },
          }),
        },
        controller.signal,
      )
      const rawPayload = await response.text()
      if (!response.ok) throw new Error(`Gemini request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      const payload = JSON.parse(rawPayload) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      const content = extractGeminiResponseText(payload)
      if (!content) throw new Error('Gemini returned no review content.')
      return parseReview(content)
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
          max_completion_tokens: 4000,
        }),
      },
      controller.signal,
    )
    const rawPayload = await response.text()
    if (!response.ok) throw new Error(`OpenAI-compatible request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
    const payload = JSON.parse(rawPayload) as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('Provider returned no review content.')
    return parseReview(content)
  } finally {
    window.clearTimeout(timeoutId)
  }
}

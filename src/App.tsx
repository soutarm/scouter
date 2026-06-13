import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import './App.css'

type ProviderKind = 'azure' | 'openai' | 'gemini'

type LlmSettings = {
  provider: ProviderKind
  azureEndpoint: string
  azureDeployment: string
  azureApiKey: string
  azureApiVersion: string
  openAiBaseUrl: string
  openAiModel: string
  openAiApiKey: string
  geminiModel: string
  geminiApiKey: string
}

type ReviewSectionKey = 'property' | 'environment' | 'crime' | 'infrastructure' | 'demographics' | 'map'

type DemographicDatum = {
  label: string
  value: number
}

type MarketRow = {
  propertyType: string
  medianPrice: string
  twelveMonthGrowth: string
  medianWeeklyRent: string
  grossYield: string
}

type SuburbSuggestion = {
  name: string
  state: AustralianState
  postcode: string
}

type Review = {
  exists?: boolean
  suburb: string
  state: string
  postcode?: string
  generatedAt: string
  summary: string
  notFoundReason?: string
  suggestedSuburb?: string
  suggestedState?: string
  marketNarrative: string
  marketRows: MarketRow[]
  climate: {
    summerAverages: string
    winterAverages: string
    airQuality?: {
      overallRating: 'Low' | 'Medium' | 'High' | 'Very High'
      overallSummary: string
      particulateMatter: string
      particulateMatterLevel: 'Low' | 'Medium' | 'High' | 'Very High'
      ozone: string
      ozoneLevel: 'Low' | 'Medium' | 'High' | 'Very High'
      pollen: string
      pollenLevel: 'Low' | 'Medium' | 'High' | 'Very High'
      industrialPollution: string
      industrialPollutionLevel: 'Low' | 'Medium' | 'High' | 'Very High'
    }
    noise?: {
      flightPath: string
      flightPathLevel: 'Low' | 'Medium' | 'High' | 'Very High'
      railNoise: string
      railNoiseLevel: 'Low' | 'Medium' | 'High' | 'Very High'
      roadNoise: string
      roadNoiseLevel: 'Low' | 'Medium' | 'High' | 'Very High'
      industrialZones: string
      industrialZonesLevel: 'Low' | 'Medium' | 'High' | 'Very High'
      overallRating: 'Low' | 'Medium' | 'High' | 'Very High'
      overallSummary: string
    }
  }
  crime: {
    narrative: string
    insuranceImpact: string
    estimatedAnnualPremiums?: {
      homeBuilding?: string
      homeContents?: string
      carComprehensive?: string
    }
    crimeTypes?: Array<{ label: string; level: 'Low' | 'Medium' | 'High' | 'Very High' }>
  }
  infrastructure: {
    transit: string
    education: string
    lifestyle: string
    demographic: string
    trainStations?: Array<{ name: string; lines: string }>
    tramStops?: string
    busAvailability?: 'Excellent' | 'Good' | 'Limited' | 'None'
    majorRoads?: string[]
    cbdDistanceKm?: number
    cbdCommuteMinutes?: number
    suburbLat?: number
    suburbLng?: number
    primarySchools?: number
    secondarySchools?: number
    shoppingPrecincts?: number
    parks?: number
    medicalCentres?: number
    pointsOfInterest?: Array<{ icon: string; label: string }>
  }
  demographics?: {
    summary: string
    population?: string
    medianAge?: string
    householdTypes?: DemographicDatum[]
    ageGroups?: DemographicDatum[]
    tenureTypes?: DemographicDatum[]
    countryOfOrigin?: DemographicDatum[]
  }
  caveats: string[]
  references?: string[]
}

const STORAGE_KEY = 'scouter.llm-settings'
const RECENT_SEARCHES_KEY = 'scouter.recent-searches'
const REVIEW_CACHE_KEY = 'scouter.review-cache'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RECENT_SEARCHES = 12
const REVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

const defaultSettings: LlmSettings = {
  provider: 'azure',
  azureEndpoint: '',
  azureDeployment: '',
  azureApiKey: '',
  azureApiVersion: '2025-04-01-preview',
  openAiBaseUrl: 'https://api.openai.com/v1',
  openAiModel: 'gpt-5.4-mini',
  openAiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  geminiApiKey: '',
}

const australianStates = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const
type AustralianState = (typeof australianStates)[number]

// Haversine straight-line distance in km
const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// CBD centre coordinates per state
const STATE_CBD: Record<AustralianState, { lat: number; lng: number; name: string; mapsQuery: string }> = {
  ACT: { lat: -35.2809, lng: 149.1300, name: 'Canberra City', mapsQuery: 'Civic+ACT+2601' },
  NSW: { lat: -33.8688, lng: 151.2093, name: 'Sydney CBD', mapsQuery: 'Sydney+CBD+NSW+2000' },
  NT:  { lat: -12.4634, lng: 130.8456, name: 'Darwin CBD', mapsQuery: 'Darwin+CBD+NT+0800' },
  QLD: { lat: -27.4705, lng: 153.0260, name: 'Brisbane CBD', mapsQuery: 'Brisbane+CBD+QLD+4000' },
  SA:  { lat: -34.9285, lng: 138.6007, name: 'Adelaide CBD', mapsQuery: 'Adelaide+CBD+SA+5000' },
  TAS: { lat: -42.8821, lng: 147.3272, name: 'Hobart CBD', mapsQuery: 'Hobart+CBD+TAS+7000' },
  VIC: { lat: -37.8136, lng: 144.9631, name: 'Melbourne CBD', mapsQuery: 'Melbourne+CBD+VIC+3000' },
  WA:  { lat: -31.9505, lng: 115.8605, name: 'Perth CBD', mapsQuery: 'Perth+CBD+WA+6000' },
}

// Public transport authority URLs per state
const STATE_PT_URLS: Record<AustralianState, { train?: string; tram?: string; bus?: string; label: string }> = {
  ACT: { bus: 'https://www.transport.act.gov.au/getting-around/by-bus', label: 'Transport Canberra' },
  NSW: { train: 'https://transportnsw.info/routes/train', bus: 'https://transportnsw.info/routes/bus', label: 'Transport NSW' },
  NT:  { bus: 'https://nt.gov.au/driving/buses-and-public-transport', label: 'NT Public Transport' },
  QLD: { train: 'https://translink.com.au/plan-your-journey/maps/rail-network-map', bus: 'https://translink.com.au', label: 'TransLink' },
  SA:  { train: 'https://www.adelaidemetro.com.au/routes-and-maps/trains', tram: 'https://www.adelaidemetro.com.au/routes-and-maps/trams', bus: 'https://www.adelaidemetro.com.au/routes-and-maps/buses', label: 'Adelaide Metro' },
  TAS: { bus: 'https://www.metrotas.com.au/timetables/', label: 'Metro Tasmania' },
  VIC: { train: 'https://ptv.vic.gov.au/routes/train/', tram: 'https://ptv.vic.gov.au/routes/tram/', bus: 'https://ptv.vic.gov.au/routes/bus/', label: 'PTV' },
  WA:  { train: 'https://www.transperth.wa.gov.au/Timetables/Train-Timetables', bus: 'https://www.transperth.wa.gov.au/Timetables/Bus-Timetables', label: 'Transperth' },
}

const STATE_NAME_MAP: Record<string, AustralianState> = {
  'australian capital territory': 'ACT',
  'new south wales': 'NSW',
  'northern territory': 'NT',
  'queensland': 'QLD',
  'south australia': 'SA',
  'tasmania': 'TAS',
  'victoria': 'VIC',
  'western australia': 'WA',
}

const mapStateName = (name: string): AustralianState | undefined =>
  STATE_NAME_MAP[name.toLowerCase().trim()]

const featuredQuickLocations = [
  'Canberra, ACT',
  'Sydney, NSW',
  'Darwin, NT',
  'Brisbane, QLD',
  'Adelaide, SA',
  'Hobart, TAS',
  'Melbourne, VIC',
  'Perth, WA',
] as const

const splitLocation = (value: string) => {
  const trimmed = value.trim()
  const match = trimmed.match(/^(.*?),\s*(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/i)
  if (!match) return { place: trimmed, state: undefined }

  return {
    place: (match[1] ?? '').trim(),
    state: (match[2] ?? '').toUpperCase() as AustralianState,
  }
}

const isAustralianState = (value: string | null | undefined): value is AustralianState =>
  australianStates.includes((value ?? '').toUpperCase() as AustralianState)

const readSearchFromQueryString = () => {
  const params = new URLSearchParams(window.location.search)
  const rawSearch = (params.get('search') ?? '').trim()
  const rawState = params.get('state')
  if (!rawSearch) return null

  const parsed = splitLocation(rawSearch)
  return {
    place: parsed.place,
    state: isAustralianState(rawState) ? rawState.toUpperCase() as AustralianState : parsed.state,
  }
}

const writeSearchToQueryString = (place: string, state: AustralianState) => {
  const params = new URLSearchParams(window.location.search)
  params.set('search', place)
  params.set('state', state)

  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}?${params.toString()}${window.location.hash}`,
  )
}

const toSearchHref = (search: string, fallbackState: AustralianState) => {
  const parsed = splitLocation(search)
  const state = parsed.state ?? fallbackState
  const params = new URLSearchParams(window.location.search)
  params.set('search', parsed.place)
  params.set('state', state)

  return `${window.location.pathname}?${params.toString()}${window.location.hash}`
}

const getSuggestedLocation = (review: Review | null) => {
  const suggestedSuburb = review?.suggestedSuburb?.trim()
  const suggestedState = review?.suggestedState?.trim().toUpperCase()

  if (!suggestedSuburb || !isAustralianState(suggestedState)) return null

  return {
    place: suggestedSuburb,
    state: suggestedState,
    label: `${suggestedSuburb}, ${suggestedState}`,
  }
}

const toMapQuery = (review: Review) => `${review.suburb}, ${review.state}, Australia`

const toGoogleMapsEmbedUrl = (review: Review) =>
  `https://www.google.com/maps?q=${encodeURIComponent(toMapQuery(review))}&output=embed`

const toGoogleMapsUrl = (review: Review) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toMapQuery(review))}`

const CLIMATE_SCALE_MIN = -10
const CLIMATE_SCALE_MAX = 50
const DEMOGRAPHIC_COLORS = ['#244b31', '#4f8f66', '#9fd7a8', '#d4e9a6', '#f1c96b', '#d9835f']

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const formatTemperature = (value: number) => `${Math.round(value)}°C`

const collectTemperatures = (text: string) => {
  const temperatures: number[] = []
  let textWithoutRanges = text

  textWithoutRanges = textWithoutRanges.replace(
    /(^|[^\d.])(-?\d+(?:\.\d+)?)\s*(?:°\s*)?(?:c\b)?\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b/gi,
    (match, prefix: string, low: string, high: string) => {
      temperatures.push(Number.parseFloat(low), Number.parseFloat(high))
      return prefix.padEnd(match.length, ' ')
    },
  )

  temperatures.push(
    ...[...textWithoutRanges.matchAll(/(^|[^\d.])(-?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b/gi)].map((match) =>
      Number.parseFloat(match[2]),
    ),
  )

  return temperatures
}

const extractTemperatureProfile = (description: string) => {
  const sentences = description.split(/(?<=[.!?])\s+/).filter(Boolean)
  const averageTemperatures: number[] = []
  const peakTemperatures: number[] = []

  sentences.forEach((sentence) => {
    const temperatures = collectTemperatures(sentence)
    if (!temperatures.length) return

    if (/heat\s*wave|heatwave|peak|extreme|record|above|push/i.test(sentence)) {
      peakTemperatures.push(...temperatures)
      return
    }

    averageTemperatures.push(...temperatures)
  })

  const fallbackTemperatures = averageTemperatures.length ? averageTemperatures : collectTemperatures(description)
  const peak = peakTemperatures.length ? Math.max(...peakTemperatures) : undefined

  if (!fallbackTemperatures.length) return peak ? { min: peak, max: peak, peak } : null

  return {
    min: Math.min(...fallbackTemperatures),
    max: Math.max(...fallbackTemperatures),
    peak: peak && peak > Math.max(...fallbackTemperatures) ? peak : undefined,
  }
}

const temperaturePosition = (value: number) =>
  ((clampNumber(value, CLIMATE_SCALE_MIN, CLIMATE_SCALE_MAX) - CLIMATE_SCALE_MIN) /
    (CLIMATE_SCALE_MAX - CLIMATE_SCALE_MIN)) *
  100

const normalizeDemographicData = (data: DemographicDatum[] | undefined) => {
  const cleanData = (data ?? []).filter((item) => item.label && Number.isFinite(item.value) && item.value > 0)
  const total = cleanData.reduce((sum, item) => sum + item.value, 0)

  if (!total) return []

  return cleanData.map((item, index) => ({
    ...item,
    color: DEMOGRAPHIC_COLORS[index % DEMOGRAPHIC_COLORS.length],
    percent: (item.value / total) * 100,
  }))
}

const tabs: Array<{ key: ReviewSectionKey; label: string }> = [
  { key: 'property', label: 'Property' },
  { key: 'crime', label: 'Safety' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'demographics', label: 'Demographics' },
  { key: 'environment', label: 'Environment' },
  { key: 'map', label: 'Map' },
]

const loadSettings = (): LlmSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings

    const parsed = JSON.parse(raw) as Partial<LlmSettings>
    const merged = { ...defaultSettings, ...parsed }
    return {
      ...merged,
      openAiModel: merged.openAiModel?.trim() || defaultSettings.openAiModel,
      geminiModel: merged.geminiModel?.trim() || defaultSettings.geminiModel,
    }
  } catch {
    return defaultSettings
  }
}

const saveSettings = (settings: LlmSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const loadRecentSearches = () => {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_SEARCHES)
      : []
  } catch {
    return []
  }
}

const saveRecentSearches = (searches: string[]) => {
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches))
}

type ReviewCacheEntry = {
  review: Review
  cachedAt: number
}

type ReviewCache = Record<string, ReviewCacheEntry>

const loadReviewCache = (): ReviewCache => {
  try {
    const raw = window.localStorage.getItem(REVIEW_CACHE_KEY)
    return raw ? (JSON.parse(raw) as ReviewCache) : {}
  } catch {
    return {}
  }
}

const getCachedReview = (query: string): Review | null => {
  const key = query.trim().toLowerCase()
  const cache = loadReviewCache()
  const entry = cache[key]
  if (!entry) return null
  if (Date.now() - entry.cachedAt > REVIEW_CACHE_TTL_MS) {
    // Expired — prune and return null
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [key]: _expired, ...rest } = cache
    window.localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(rest))
    return null
  }
  return entry.review
}

const setCachedReview = (query: string, review: Review) => {
  const key = query.trim().toLowerCase()
  const cache = loadReviewCache()
  cache[key] = { review, cachedAt: Date.now() }
  try {
    window.localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage quota exceeded — silently skip caching
  }
}

const stripJsonFence = (value: string): string => {
  const trimmed = value.trim()
  // Strip markdown code fences if present
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  // Extract the outermost JSON object in case the model adds prose before/after
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return fenced.slice(start, end + 1)
  }
  return fenced
}

const parseReferenceLink = (reference: string) => {
  const trimmed = reference.trim()
  const markdownLink = trimmed.match(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/i)

  if (markdownLink) {
    return {
      label: markdownLink[1].trim(),
      url: markdownLink[2].trim(),
    }
  }

  const urlMatch = trimmed.match(/https?:\/\/[^\s)\]]+/i)

  if (!urlMatch) {
    return { label: trimmed, url: '' }
  }

  const url = urlMatch[0].replace(/[.,;:]+$/, '')
  const label = trimmed.replace(urlMatch[0], '').replace(/[\s,;:-]+$/, '').trim()

  return {
    label: label || url,
    url,
  }
}

const fetchHomelyContext = async (suburb: string, state: string, postcode?: string): Promise<string> => {
  try {
    const slug = `${suburb.toLowerCase().replace(/\s+/g, '-')}-${state.toLowerCase()}${postcode ? `-${postcode}` : ''}`
    const url = `https://www.homely.com.au/suburb-profile/${slug}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return ''
    const html = await res.text()
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const article = doc.querySelector('article')
    if (!article) return ''
    // Strip listing cards — they contain property addresses not useful for context
    article.querySelectorAll('[class*="listing"], [class*="Listing"], [class*="property-card"]').forEach(el => el.remove())
    const raw = article.innerText ?? article.textContent ?? ''
    // Trim to 2500 chars to avoid blowing out token budget
    return raw.replace(/\s+/g, ' ').trim().slice(0, 2500)
  } catch {
    return ''
  }
}

const buildPrompt = (query: string, homelyContext?: string) => `You are an Australian suburb research analyst.

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
  "caveats": ["Any uncertainty, unavailable fresh data, or source limitation."],
  "references": ["Named data source, publication, or public agency used or recommended for verification, including a URL when available."]
}`

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

const friendlyRequestError = (caught: unknown) => {
  if (caught instanceof DOMException && caught.name === 'AbortError') {
    return 'The LLM request timed out after 60 seconds. Try a smaller/faster model or run the query again.'
  }

  if (caught instanceof TypeError && /fetch|network|failed/i.test(caught.message)) {
    return 'The browser could not reach the LLM provider. This is usually CORS or network blocking. Pulse avoids this with a server route, but GitHub Pages is static, so direct browser calls only work with providers that allow browser CORS requests.'
  }

  return caught instanceof Error ? caught.message : 'Review generation failed.'
}

const repairTruncatedJson = (s: string): string => {
  // Walk backwards from the end to find the last position where the JSON
  // was still structurally valid by closing open braces/brackets.
  const stack: string[] = []
  let inString = false
  let escape = false
  for (const ch of s) {
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (stack.length === 0) return s
  // Trim to after the last complete comma-separated value by chopping at
  // the last ',' or valid closing character, then close all open scopes.
  let trimmed = s.trimEnd()
  // Remove trailing incomplete fragment (unclosed string or partial key/value)
  trimmed = trimmed.replace(/,?\s*"[^"]*$/, '').replace(/,\s*$/, '')
  return trimmed + stack.reverse().join('')
}

const parseReview = (content: string): Review => {
  const stripped = stripJsonFence(content)
  let parsed: Review
  try {
    parsed = JSON.parse(stripped) as Review
  } catch (e) {
    // Attempt to recover truncated JSON before giving up
    try {
      parsed = JSON.parse(repairTruncatedJson(stripped)) as Review
    } catch {
      const snippet = stripped.slice(0, 300).replace(/\n/g, ' ')
      throw new Error(`The model returned invalid JSON. Parse error: ${e instanceof Error ? e.message : e}. Content preview: ${snippet}`)
    }
  }
  // Handle legacy string crime field from cached/old responses
  if (typeof parsed.crime === 'string') {
    parsed.crime = { narrative: parsed.crime as unknown as string, insuranceImpact: '' }
  }
  if (parsed.exists === false && parsed.summary) {
    return parsed
  }

  if (!parsed.summary || !Array.isArray(parsed.marketRows) || !parsed.infrastructure) {
    throw new Error('The model returned JSON, but not the expected review shape.')
  }
  return parsed
}

const callLlm = async (settings: LlmSettings, query: string, homelyContext?: string): Promise<Review> => {
  const prompt = buildPrompt(query, homelyContext)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    if (settings.provider === 'azure') {
      if (!settings.azureEndpoint || !settings.azureDeployment || !settings.azureApiKey) {
        throw new Error('Azure endpoint, deployment and API key are required.')
      }

      const response = await fetch(
        `${settings.azureEndpoint.replace(/\/$/, '')}/openai/responses?api-version=${settings.azureApiVersion || defaultSettings.azureApiVersion}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': settings.azureApiKey,
          },
          body: JSON.stringify({
            model: settings.azureDeployment,
            input: [{ role: 'user', content: prompt }],
            text: { format: { type: 'json_object' }, verbosity: 'low' },
            reasoning: { effort: 'low' },
            max_output_tokens: 4000,
          }),
          signal: controller.signal,
        },
      )

      const rawPayload = await response.text()
      if (!response.ok) {
        throw new Error(`Azure request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      }

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

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(settings.geminiModel)}:generateContent?key=${encodeURIComponent(settings.geminiApiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
              maxOutputTokens: 4000,
            },
          }),
          signal: controller.signal,
        },
      )

      const rawPayload = await response.text()
      if (!response.ok) {
        throw new Error(`Gemini request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      }

      const payload = JSON.parse(rawPayload) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const content = extractGeminiResponseText(payload)
      if (!content) throw new Error('Gemini returned no review content.')
      return parseReview(content)
    }

    if (!settings.openAiApiKey || !settings.openAiModel) {
      throw new Error('OpenAI-compatible API key and model are required.')
    }

    const response = await fetch(`${settings.openAiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: settings.openAiModel,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 4000,
      }),
      signal: controller.signal,
    })

    const rawPayload = await response.text()
    if (!response.ok) {
      throw new Error(`OpenAI-compatible request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
    }

    const payload = JSON.parse(rawPayload) as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('Provider returned no review content.')
    return parseReview(content)
  } finally {
    window.clearTimeout(timeoutId)
  }
}


const ThermometerRange = ({ label, description }: { label: string; description: string }) => {
  const profile = extractTemperatureProfile(description)

  if (!profile) {
    return (
      <div className="thermometer-card">
        <p className="thermometer-label">{label}</p>
        <p className="thermometer-empty">Temperature range unavailable</p>
      </div>
    )
  }

  const minPosition = temperaturePosition(profile.min)
  const maxPosition = temperaturePosition(profile.max)
  const peakPosition = profile.peak ? temperaturePosition(profile.peak) : null

  return (
    <div className="thermometer-card" aria-label={`${label} temperature range`}>
      <div className="thermometer-header">
        <p className="thermometer-label">{label}</p>
        <p>
          <span>{formatTemperature(profile.min)}</span>
          <span>{formatTemperature(profile.max)}</span>
          {profile.peak ? <span>HW {formatTemperature(profile.peak)}</span> : null}
        </p>
      </div>
      <div className="thermometer-track" aria-hidden="true">
        <span className="thermometer-fill" style={{ left: `${minPosition}%`, width: `${Math.max(maxPosition - minPosition, 2)}%` }} />
        <span className="thermometer-marker min" style={{ left: `${minPosition}%` }} />
        <span className="thermometer-marker max" style={{ left: `${maxPosition}%` }} />
        {peakPosition !== null ? <span className="thermometer-marker peak" style={{ left: `${peakPosition}%` }} /> : null}
      </div>
      <div className="thermometer-scale" aria-hidden="true">
        <span>{formatTemperature(CLIMATE_SCALE_MIN)}</span>
        {profile.peak && peakPosition !== null ? <span className="thermometer-peak-label" style={{ left: `${peakPosition}%` }}>HW</span> : null}
        <span>{formatTemperature(CLIMATE_SCALE_MAX)}</span>
      </div>
    </div>
  )
}

const LocationPinIcon = () => (
  <svg className="location-pin" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <path d="M12 21s6.3-5.6 6.3-11.1A6.3 6.3 0 0 0 5.7 9.9C5.7 15.4 12 21 12 21Z" />
    <circle cx="12" cy="9.9" r="2.15" />
  </svg>
)

// Search type icons
const IconAllListings = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="7" height="7" rx="1.5" />
    <rect x="11" y="2" width="7" height="7" rx="1.5" />
    <rect x="2" y="11" width="7" height="7" rx="1.5" />
    <rect x="11" y="11" width="7" height="7" rx="1.5" />
  </svg>
)

const IconHouse = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5 10 3l7 6.5" />
    <path d="M5 8v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" />
    <rect x="7.5" y="12" width="5" height="5" rx="0.5" />
  </svg>
)

const IconUnit = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="16" height="14" rx="2" />
    <path d="M2 8h16M10 3v14M6 11h1m6 0h1M6 14h1m6 0h1" />
  </svg>
)

// Site logos using real favicons
const LogoRealEstate = () => (
  <img src="./logo-rea.png" alt="realestate.com.au" className="listing-site-logo" />
)

const LogoDomain = () => (
  <img src="./logo-domain.png" alt="domain.com.au" className="listing-site-logo" />
)

const LogoHomely = () => (
  <img src="./logo-homely.png" alt="homely.com.au" className="listing-site-logo" />
)

const DemographicPieChart = ({ title, data }: { title: string; data: DemographicDatum[] | undefined }) => {
  const segments = normalizeDemographicData(data)

  if (!segments.length) {
    return (
      <div className="demographic-chart-card">
        <h3>{title}</h3>
        <p className="demographic-empty">Pie chart data unavailable.</p>
      </div>
    )
  }

  const gradient = segments
    .reduce<{ stops: string[]; cursor: number }>(
      (acc, segment) => {
        const start = acc.cursor
        const end = acc.cursor + segment.percent
        return { stops: [...acc.stops, `${segment.color} ${start}% ${end}%`], cursor: end }
      },
      { stops: [], cursor: 0 },
    )
    .stops.join(', ')

  return (
    <div className="demographic-chart-card">
      <h3>{title}</h3>
      <div className="demographic-chart-layout">
        <div
          className="demographic-pie"
          style={{ '--demographic-gradient': `conic-gradient(${gradient})` } as React.CSSProperties}
          role="img"
          aria-label={`${title}: ${segments.map((segment) => `${segment.label} ${Math.round(segment.percent)}%`).join(', ')}`}
        />
        <ul className="demographic-legend">
          {segments.map((segment) => (
            <li key={segment.label}>
              <span className="demographic-swatch" style={{ background: segment.color }} aria-hidden="true" />
              <span>{segment.label}</span>
              <strong>{Math.round(segment.percent)}%</strong>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const CRIME_LEVEL_MAP = { Low: 1, Medium: 2, High: 3, 'Very High': 4 } as const
const CRIME_LEVEL_COLORS: Record<string, string> = {
  Low: '#4f8f66',
  Medium: '#d4a843',
  High: '#c0703b',
  'Very High': '#b03020',
}

const CrimeBar = ({ label, level }: { label: string; level: 'Low' | 'Medium' | 'High' | 'Very High' }) => {
  const filled = CRIME_LEVEL_MAP[level]
  return (
    <div className="crime-bar-row">
      <span className="crime-bar-label">{label}</span>
      <div className="crime-bar-track" aria-label={`${label}: ${level}`}>
        {([1, 2, 3, 4] as const).map((step) => (
          <span
            key={step}
            className="crime-bar-segment"
            style={step <= filled ? { background: CRIME_LEVEL_COLORS[level] } : undefined}
            aria-hidden="true"
          />
        ))}
      </div>
      <span className="crime-bar-level" style={{ color: CRIME_LEVEL_COLORS[level] }}>{level}</span>
    </div>
  )
}

function App() {
  const [query, setQuery] = useState('')
  const [selectedState, setSelectedState] = useState<AustralianState>('TAS')
  const [settings, setSettings] = useState<LlmSettings>(() => loadSettings())
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches())
  const [showSettings, setShowSettings] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(true)
  const [review, setReview] = useState<Review | null>(null)
  const [activeTab, setActiveTab] = useState<ReviewSectionKey>('property')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Loaded from this browser')
  const [showReferences, setShowReferences] = useState(false)
  const [suggestions, setSuggestions] = useState<SuburbSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSearchStartedRef = useRef(false)

  const providerReady = useMemo(() => {
    if (settings.provider === 'azure') {
      return Boolean(settings.azureEndpoint && settings.azureDeployment && settings.azureApiKey)
    }

    if (settings.provider === 'gemini') {
      return Boolean(settings.geminiApiKey && settings.geminiModel)
    }

    return Boolean(settings.openAiApiKey && settings.openAiModel)
  }, [settings])

  const quickLocationTags = useMemo(() => {
    const seen = new Set<string>()
    const uniqueRecentSearches = recentSearches.filter((search) => {
      const key = search.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, MAX_RECENT_SEARCHES)

    if (uniqueRecentSearches.length >= featuredQuickLocations.length) {
      return uniqueRecentSearches
    }

    return [
      ...uniqueRecentSearches,
      ...featuredQuickLocations.filter((search) => !seen.has(search.toLowerCase())),
    ].slice(0, featuredQuickLocations.length)
  }, [recentSearches])

  const composedQuery = query.trim() ? `${query.trim()}, ${selectedState}` : ''
  const locationNotFound = review?.exists === false
  const suggestedLocation = getSuggestedLocation(review)
  const demographicSummary = review?.demographics?.summary || review?.infrastructure.demographic || ''
  const primaryDemographicData = review?.demographics?.ageGroups?.length
    ? review.demographics.ageGroups
    : review?.demographics?.householdTypes

  const updateSettings = (next: LlmSettings) => {
    setSettings(next)
    saveSettings(next)
    setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  }

  const rememberSearch = useCallback((search: string) => {
    const normalized = search.trim()
    if (!normalized) return

    setRecentSearches((current) => {
      const next = [
        normalized,
        ...current.filter((item) => item.trim().toLowerCase() !== normalized.toLowerCase()),
      ].slice(0, MAX_RECENT_SEARCHES)
      saveRecentSearches(next)
      return next
    })
  }, [])

  const fetchSuggestions = useCallback((value: string) => {
    if (suggestionsDebounceRef.current) clearTimeout(suggestionsDebounceRef.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    suggestionsDebounceRef.current = setTimeout(async () => {
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=8&lang=en&bbox=96.82,-43.74,168.0,-9.14`
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json() as { features?: Array<{ properties: { name?: string; state?: string; postcode?: string; type?: string; osm_value?: string } }> }
        const results: SuburbSuggestion[] = (data.features ?? [])
          .filter((f) => {
            const p = f.properties
            // Only suburbs, towns, cities, villages, localities
            const relevant = ['suburb', 'city', 'town', 'village', 'locality', 'quarter', 'borough']
            return (
              p.name &&
              p.state &&
              mapStateName(p.state) &&
              (relevant.includes(p.type ?? '') || relevant.includes(p.osm_value ?? ''))
            )
          })
          .map((f) => ({
            name: f.properties.name!,
            state: mapStateName(f.properties.state!)!,
            postcode: f.properties.postcode ?? '',
          }))
          // Dedupe by name+state
          .filter((item, idx, arr) => arr.findIndex((x) => x.name === item.name && x.state === item.state) === idx)
          .slice(0, 6)

        setSuggestions(results)
        setShowSuggestions(results.length > 0)
      } catch {
        // Silently fail — autocomplete is best-effort
      }
    }, 280)
  }, [])

  const runSearch = useCallback(
    async (place: string, state: AustralianState, options: { updateQueryString?: boolean } = {}) => {
      const trimmedPlace = place.trim()
      const trimmedQuery = trimmedPlace ? `${trimmedPlace}, ${state}` : ''
      if (!trimmedQuery) return

      setQuery(trimmedPlace)
      setSelectedState(state)

      if (options.updateQueryString !== false) {
        writeSearchToQueryString(trimmedPlace, state)
      }

      if (!providerReady) {
        setShowSettings(true)
        setError('Add LLM settings before running a review.')
        return
      }

      // Check cache before hitting the LLM
      const cached = getCachedReview(trimmedQuery)
      if (cached) {
        setHasSearched(true)
        setIsSearchOpen(false)
        setReview(cached)
        setActiveTab('property')
        setShowReferences(false)
        return
      }

      setIsLoading(true)
      setError('')
      setShowReferences(false)
      setReview(null)
      setActiveTab('property')
      setHasSearched(true)
      setIsSearchOpen(false)
      try {
        // Fetch Homely context in parallel with the start of LLM call setup
        const homelyContext = await fetchHomelyContext(trimmedPlace, state)
        const result = await callLlm(settings, trimmedQuery, homelyContext)
        const nextReview = { ...result, generatedAt: result.generatedAt || new Date().toISOString() }
        setReview(nextReview)
        if (nextReview.exists !== false) {
          rememberSearch(trimmedQuery)
          setCachedReview(trimmedQuery, nextReview)
        }
      } catch (caught) {
        setError(friendlyRequestError(caught))
      } finally {
        setIsLoading(false)
      }
    },
    [providerReady, rememberSearch, settings],
  )

  useEffect(() => {
    if (autoSearchStartedRef.current) return

    const initialSearch = readSearchFromQueryString()
    if (!initialSearch?.place) return

    const initialState = initialSearch.state ?? selectedState
    autoSearchStartedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runSearch(initialSearch.place, initialState)
  }, [runSearch, selectedState])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedQuery = splitLocation(query)
    const place = parsedQuery.place
    const state = parsedQuery.state ?? selectedState
    const trimmedQuery = place ? `${place}, ${state}` : ''
    if (!trimmedQuery) return
    await runSearch(place, state)
  }

  const downloadPdf = async () => {
    if (!review) return
    setIsExporting(true)
    setError('')
    try {
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 16
      const maxWidth = pageWidth - margin * 2
      let y = 18

      const ensureSpace = (height: number) => {
        if (y + height > pageHeight - margin) {
          pdf.addPage()
          y = margin
        }
      }

      const write = (text: string, size = 10, style: 'normal' | 'bold' = 'normal', gap = 5) => {
        pdf.setFont('helvetica', style)
        pdf.setFontSize(size)
        const lines = pdf.splitTextToSize(text, maxWidth) as string[]
        const height = lines.length * (size * 0.42) + gap
        ensureSpace(height)
        pdf.text(lines, margin, y)
        y += height
      }

      const section = (heading: string, body: string) => {
        y += 2
        write(heading, 13, 'bold', 4)
        write(body, 10, 'normal', 7)
      }

      pdf.setFillColor(248, 251, 244)
      pdf.rect(0, 0, pageWidth, pageHeight, 'F')
      write(`${review.suburb}, ${review.state} Profile`, 20, 'bold', 7)
      write(review.summary, 11, 'normal', 8)

      section('Property Market & Rental Realities', review.marketNarrative)
      review.marketRows.forEach((row) => {
        write(
          `${row.propertyType}: ${row.medianPrice}, ${row.twelveMonthGrowth} growth, ${row.medianWeeklyRent} rent, ${row.grossYield} yield`,
          9,
          'normal',
          3,
        )
      })

      section('Climate & Environment', [
        `Summer: ${review.climate.summerAverages}`,
        `Winter: ${review.climate.winterAverages}`,
        review.climate.airQuality
          ? `\nAir Quality (${review.climate.airQuality.overallRating}): ${review.climate.airQuality.overallSummary}\nParticulate matter: ${review.climate.airQuality.particulateMatter}\nOzone: ${review.climate.airQuality.ozone}\nPollen: ${review.climate.airQuality.pollen}\nIndustrial pollution: ${review.climate.airQuality.industrialPollution}`
          : '',
        review.climate.noise
          ? `\nNoise & Amenity (${review.climate.noise.overallRating}): ${review.climate.noise.overallSummary}\nFlight paths: ${review.climate.noise.flightPath}\nRail: ${review.climate.noise.railNoise}\nRoad: ${review.climate.noise.roadNoise}\nIndustrial: ${review.climate.noise.industrialZones}`
          : '',
      ].filter(Boolean).join('\n\n'))
      section('Safety & Insurance', [
        review.crime.narrative,
        review.crime.insuranceImpact ? `\nInsurance impact: ${review.crime.insuranceImpact}` : '',
        review.crime.estimatedAnnualPremiums ? `\nEstimated annual premiums:\n${Object.entries(review.crime.estimatedAnnualPremiums).map(([k, v]) => `  ${k}: ${v}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n'))
      section(
        'Infrastructure, Education & Logistics',
        [
          review.infrastructure.cbdDistanceKm != null ? `CBD distance: ${review.infrastructure.cbdDistanceKm} km (${review.infrastructure.cbdCommuteMinutes ?? '?'} min commute)` : '',
          review.infrastructure.trainStations?.length ? `Train stations: ${review.infrastructure.trainStations.map(s => `${s.name} (${s.lines})`).join(', ')}` : '',
          review.infrastructure.tramStops ? `Tram: ${review.infrastructure.tramStops}` : '',
          review.infrastructure.busAvailability ? `Bus: ${review.infrastructure.busAvailability}` : '',
          review.infrastructure.majorRoads?.length ? `Major roads: ${review.infrastructure.majorRoads.join(', ')}` : '',
          `Transit & Commute: ${review.infrastructure.transit}`,
          `Education & Catchments: ${review.infrastructure.education}`,
          `Lifestyle & Amenities: ${review.infrastructure.lifestyle}`,
        ].filter(Boolean).join('\n\n'),
      )

      if (review.demographics) {
        section(
          'Demographics',
          [
            review.demographics.summary,
            review.demographics.population ? `Population: ${review.demographics.population}` : '',
            review.demographics.medianAge ? `Median age: ${review.demographics.medianAge}` : '',
            review.demographics.ageGroups?.length
              ? `Age groups: ${review.demographics.ageGroups.map((item) => `${item.label} ${item.value}%`).join(', ')}`
              : '',
            review.demographics.householdTypes?.length
              ? `Household types: ${review.demographics.householdTypes.map((item) => `${item.label} ${item.value}%`).join(', ')}`
              : '',
            review.demographics.countryOfOrigin?.length
              ? `Country of origin: ${review.demographics.countryOfOrigin.map((item) => `${item.label} ${item.value}%`).join(', ')}`
              : '',
          ].filter(Boolean).join('\n\n'),
        )
      }

      if (review.caveats?.length) {
        section('Caveats', review.caveats.map((caveat) => `- ${caveat}`).join('\n'))
      }

      if (review.references?.length) {
        section('References', review.references.map((reference) => `- ${reference}`).join('\n'))
      }

      const fileName = `${review.suburb || 'suburb'}-${review.state || 'review'}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      pdf.save(`${fileName}.pdf`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PDF export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <h1 className="brand-wordmark" aria-label="Scouter">
          <span className="brand-letter brand-letter-s" aria-hidden="true">S</span>
          <span className="brand-letter" aria-hidden="true">C</span>
          <span className="brand-letter" aria-hidden="true">O</span>
          <span className="brand-letter" aria-hidden="true">U</span>
          <span className="brand-letter" aria-hidden="true">T</span>
          <span className="brand-letter" aria-hidden="true">E</span>
          <span className="brand-letter brand-letter-r" aria-hidden="true">R</span>
        </h1>
        <button
          className="settings-button"
          type="button"
          onClick={() => setShowSettings((open) => !open)}
          aria-label="LLM settings"
          aria-expanded={showSettings}
          title="LLM settings"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5A8.9 8.9 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
        </button>
      </header>

      {showSettings && (
        <section className="settings-card" aria-label="LLM settings">
          <div className="settings-header">
            <div>
              <h2>Provider settings</h2>
              <p>Stored locally in this browser. Do not use public/shared API keys.</p>
            </div>
            <div className="settings-controls">
              <span className={providerReady ? 'status-pill ready' : 'status-pill'}>
                {providerReady ? `Ready, ${saveStatus}` : saveStatus}
              </span>
              <select
                value={settings.provider}
                onChange={(event) => updateSettings({ ...settings, provider: event.target.value as ProviderKind })}
              >
                <option value="azure">Azure OpenAI</option>
                <option value="openai">OpenAI compatible</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </div>
          </div>

          {settings.provider === 'azure' ? (
            <div className="settings-grid">
              <label>
                Endpoint
                <input
                  placeholder="https://example.openai.azure.com"
                  value={settings.azureEndpoint}
                  onChange={(event) => updateSettings({ ...settings, azureEndpoint: event.target.value })}
                />
              </label>
              <label>
                Deployment
                <input
                  placeholder="gpt-5.4-mini"
                  value={settings.azureDeployment}
                  onChange={(event) => updateSettings({ ...settings, azureDeployment: event.target.value })}
                />
              </label>
              <label>
                API version
                <input
                  value={settings.azureApiVersion}
                  onChange={(event) => updateSettings({ ...settings, azureApiVersion: event.target.value })}
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={settings.azureApiKey}
                  onChange={(event) => updateSettings({ ...settings, azureApiKey: event.target.value })}
                />
              </label>
            </div>
          ) : settings.provider === 'gemini' ? (
            <div className="settings-grid">
              <label>
                Model
                <input
                  placeholder="gemini-2.5-flash"
                  value={settings.geminiModel}
                  onChange={(event) => updateSettings({ ...settings, geminiModel: event.target.value })}
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={settings.geminiApiKey}
                  onChange={(event) => updateSettings({ ...settings, geminiApiKey: event.target.value })}
                />
              </label>
              <p className="settings-note">
                Uses Google AI Studio's Gemini API directly from this browser. Keep keys restricted where possible.
              </p>
            </div>
          ) : (
            <div className="settings-grid">
              <label>
                Base URL
                <input
                  value={settings.openAiBaseUrl}
                  onChange={(event) => updateSettings({ ...settings, openAiBaseUrl: event.target.value })}
                />
              </label>
              <label>
                Model
                <input
                  placeholder="gpt-5.4-mini"
                  value={settings.openAiModel}
                  onChange={(event) => updateSettings({ ...settings, openAiModel: event.target.value })}
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={settings.openAiApiKey}
                  onChange={(event) => updateSettings({ ...settings, openAiApiKey: event.target.value })}
                />
              </label>
            </div>
          )}
          <div className="settings-footer">
            <button
              type="button"
              className="clear-cache-button"
              onClick={() => {
                window.localStorage.removeItem(RECENT_SEARCHES_KEY)
                window.localStorage.removeItem(REVIEW_CACHE_KEY)
                setRecentSearches([])
              }}
            >
              Clear cache &amp; recent searches
            </button>
          </div>
        </section>
      )}

      <section className={hasSearched && !isSearchOpen ? 'hero-panel collapsed' : 'hero-panel'}>
        {hasSearched && !isSearchOpen ? (
          <button
            className="search-accordion-button"
            type="button"
            onClick={() => setIsSearchOpen(true)}
            aria-expanded={isSearchOpen}
          >
            <span>
              <span className="eyebrow">Suburb search</span>
              <strong>{composedQuery || 'Search another suburb'}</strong>
            </span>
            {isLoading
              ? <span className="button-spinner accordion-spinner" aria-label="Scouting" />
              : <span>{review && !locationNotFound ? 'Scout again' : 'Change search'}</span>
            }
          </button>
        ) : (
          <>
            <div className="hero-copy">
              <span className="pill">Property, climate, crime, logistics</span>
              <h2>Scout a location before you make your move.</h2>
              <p>Enter a location and state and let us scout it out.</p>
            </div>
            <svg className="hero-contours" aria-hidden="true" viewBox="0 0 260 220" focusable="false">
              <path d="M231 13c-38 4-72 16-101 37-28 20-46 43-83 49-21 4-37 1-56-5" />
              <path d="M251 62c-36 7-66 20-91 39-32 24-50 53-95 57-25 2-43-5-65-18" />
              <path d="M243 118c-27 2-50 11-70 26-24 18-39 41-73 48-24 5-50 0-76-16" />
              <path d="M202 11c-16 23-23 45-20 66 4 28 24 49 21 82-2 19-11 34-27 48" />
            </svg>
            <form className="search-card" onSubmit={handleSubmit}>
              <div className="search-card-heading">
                <span>Suburb search</span>
              </div>
              <label htmlFor="suburb-query">Location</label>
              <div className="search-input-wrap">
                <div className="search-row">
                  <input
                    id="suburb-query"
                    placeholder="Hobart"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value)
                      fetchSuggestions(event.target.value)
                    }}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    onFocus={() => {
                      setQuery('')
                      setSuggestions([])
                      setShowSuggestions(false)
                    }}
                    autoComplete="off"
                    disabled={isLoading}
                  />
                  <button
                    type="submit"
                    className={isLoading ? 'is-loading' : undefined}
                    disabled={isLoading || !query.trim()}
                    aria-label={isLoading ? 'Scouting location' : undefined}
                  >
                    {isLoading ? <span className="button-spinner" aria-label="Scouting" /> : 'Scout'}
                  </button>
                </div>
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="suggestions-list" role="listbox" aria-label="Location suggestions">
                    {suggestions.map((s) => (
                      <li
                        key={`${s.name}-${s.state}`}
                        role="option"
                        aria-selected={false}
                        className="suggestions-item"
                        onMouseDown={(event) => {
                          event.preventDefault()
                          setSuggestions([])
                          setShowSuggestions(false)
                          void runSearch(s.name, s.state)
                        }}
                      >
                        <span className="suggestions-name">{s.name}</span>
                        <span className="suggestions-meta">{s.state}{s.postcode ? ` · ${s.postcode}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {quickLocationTags.length > 0 && (
                <div className="quick-location-grid" aria-label="Quick location selections">
                  {quickLocationTags.map((search) => (
                    <a
                      key={search}
                      className="quick-location-tag"
                      href={toSearchHref(search, selectedState)}
                      onClick={(event) => {
                        event.preventDefault()
                        setSuggestions([])
                        setShowSuggestions(false)
                        const parsed = splitLocation(search)
                        if (!parsed.place) return
                        void runSearch(parsed.place, parsed.state ?? selectedState)
                      }}
                    >
                      <LocationPinIcon />
                      <span>{search}</span>
                    </a>
                  ))}
                </div>
              )}
            </form>
          </>
        )}
      </section>

      {isLoading && (
        <section className="busy-card" aria-live="polite">
          <div className="spinner" />
          <div>
            <h2>Scouting location...</h2>
          </div>
        </section>
      )}

      {error && <div className="error-card">{error}</div>}

      {review && (
        <section className="review-wrap">
          <div className={showReferences ? 'references-drawer open' : 'references-drawer'}>
            <button
              type="button"
              className="references-tab"
              onClick={() => setShowReferences((visible) => !visible)}
              aria-expanded={showReferences}
              aria-controls="references-panel"
            >
              References
            </button>

            <section id="references-panel" className="references-panel" aria-label="All references" aria-hidden={!showReferences}>
              <div className="references-panel-header">
                <div>
                  <p className="eyebrow">References</p>
                  <h2>All references</h2>
                </div>
              </div>
              {review.references?.length ? (
                <ol>
                  {review.references.map((reference) => (
                    <li key={reference}>
                      {(() => {
                        const parsed = parseReferenceLink(reference)
                        return parsed.url ? (
                          <a href={parsed.url} target="_blank" rel="noreferrer">
                            {parsed.label}
                          </a>
                        ) : (
                          parsed.label
                        )
                      })()}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="references-empty">
                  No references are available for this review yet.
                </p>
              )}
            </section>
          </div>

          <div className="review-actions">
            <div>
              <p className="eyebrow">Generated review</p>
              <h2>
                {review.suburb}, {review.state}
              </h2>
            </div>
          </div>

          <article className="review-card">
            {locationNotFound ? (
              <section className="not-found-card" aria-label="Location not found">
                <div className="not-found-illustration" aria-hidden="true">
                  <span className="not-found-sun" />
                  <span className="not-found-map" />
                  <span className="not-found-path" />
                  <span className="not-found-marker">?</span>
                </div>
                <div>
                  <p className="eyebrow">Location not found</p>
                  <h2>We could not scout this location.</h2>
                  <p>{review.notFoundReason || review.summary}</p>
                  <button
                    type="button"
                    className="primary-lite"
                    onClick={() => {
                      if (suggestedLocation) {
                        void runSearch(suggestedLocation.place, suggestedLocation.state)
                        return
                      }

                      setIsSearchOpen(true)
                    }}
                  >
                    {suggestedLocation ? `Try ${suggestedLocation.label}` : 'Try another search'}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <section className="summary-card">
                  <div>
                    <p className="eyebrow">Summary</p>
                    <h2>
                      {review.suburb}, {review.state} Profile
                    </h2>
                  </div>
                  <p>{review.summary}</p>
                  <button type="button" className="summary-download primary-lite" onClick={downloadPdf} disabled={isExporting}>
                    {isExporting ? 'Preparing PDF...' : 'Download PDF'}
                  </button>
                </section>

                <nav className="tabs" aria-label="Review sections">
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={activeTab === tab.key ? 'active' : ''}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>

                {activeTab === 'property' && (
                  <section className="tab-panel">
                    <h3>Property Market & Rental Realities</h3>
                    <p>{review.marketNarrative}</p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Property Type</th>
                            <th>Median Price</th>
                            <th>12-Month Growth</th>
                            <th>Median Weekly Rent</th>
                            <th>Gross Yield</th>
                          </tr>
                        </thead>
                        <tbody>
                          {review.marketRows.map((row) => (
                            <tr key={row.propertyType}>
                              <td>{row.propertyType}</td>
                              <td>{row.medianPrice}</td>
                              <td>{row.twelveMonthGrowth}</td>
                              <td>{row.medianWeeklyRent}</td>
                              <td>{row.grossYield}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="listing-links">
                      <p className="eyebrow">Search listings</p>
                      <div className="listing-link-grid">
                        {(() => {
                          const slug = review.suburb.toLowerCase().replace(/\s+/g, '-')
                          const slugPlus = review.suburb.toLowerCase().replace(/\s+/g, '+')
                          const stateUp = review.state.toUpperCase()
                          const stateLow = review.state.toLowerCase()
                          const pc = review.postcode ?? ''
                          const domainSlug = `${slug}-${stateLow}${pc ? `-${pc}` : ''}`
                          const homelySlug = `${slug}-${stateLow}${pc ? `-${pc}` : ''}`
                          const reaLocation = `${slugPlus},+${stateUp}${pc ? `+${pc}` : ''}`
                          return ([
                            {
                              Logo: LogoRealEstate,
                              links: [
                                { href: `https://www.realestate.com.au/buy/in-${reaLocation}/list-1`, label: 'All listings', Icon: IconAllListings },
                                { href: `https://www.realestate.com.au/buy/property-house-in-${reaLocation}/list-1`, label: 'Houses', Icon: IconHouse },
                                { href: `https://www.realestate.com.au/buy/property-townhouse-in-${reaLocation}/list-1`, label: 'Townhouses', Icon: IconUnit },
                              ],
                            },
                            {
                              Logo: LogoDomain,
                              links: [
                                { href: `https://www.domain.com.au/sale/${domainSlug}/`, label: 'All listings', Icon: IconAllListings },
                                { href: `https://www.domain.com.au/sale/${domainSlug}/house/`, label: 'Houses', Icon: IconHouse },
                                { href: `https://www.domain.com.au/sale/${domainSlug}/town-house/`, label: 'Townhouses', Icon: IconUnit },
                              ],
                            },
                            {
                              Logo: LogoHomely,
                              links: [
                                { href: `https://www.homely.com.au/for-sale/${homelySlug}/real-estate`, label: 'All listings', Icon: IconAllListings },
                                { href: `https://www.homely.com.au/for-sale/${homelySlug}/houses`, label: 'Houses', Icon: IconHouse },
                                { href: `https://www.homely.com.au/for-sale/${homelySlug}/real-estate?propertytype=units,townhouses`, label: 'Units & Townhouses', Icon: IconUnit },
                              ],
                            },
                          ])
                        })().map(({ Logo, links }) => (
                          <div key={Logo.name} className="listing-site-card">
                            <Logo />
                            <div className="listing-site-divider" aria-hidden="true" />
                            <div className="listing-link-row">
                              {links.map(({ href, label, Icon }) => (
                                <a key={label} href={href} target="_blank" rel="noreferrer" className="listing-link" aria-label={label} title={label}>
                                  <Icon />
                                </a>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                )}

                 {activeTab === 'environment' && (
                   <section className="tab-panel environment-panel">
                     <div className="environment-section">
                       <p className="eyebrow">Climate</p>
                       <div className="climate-panel">
                         <div className="climate-card">
                           <h3>Summer Averages</h3>
                           <ThermometerRange label="Summer min / max" description={review.climate.summerAverages} />
                           <p>{review.climate.summerAverages}</p>
                         </div>
                         <div className="climate-card">
                           <h3>Winter Averages</h3>
                           <ThermometerRange label="Winter min / max" description={review.climate.winterAverages} />
                           <p>{review.climate.winterAverages}</p>
                         </div>
                       </div>
                     </div>
                      {review.climate.airQuality && (
                        <div className="environment-section">
                          <p className="eyebrow">Air Quality</p>
                          <div className="noise-panel">
                            <div className="noise-rating-card">
                              <div className="crime-chart-card noise-bars-card">
                                <h3>Air quality by source</h3>
                                <div className="crime-bars">
                                  <CrimeBar label="Particulate matter" level={review.climate.airQuality.particulateMatterLevel ?? 'Low'} />
                                  <CrimeBar label="Ozone" level={review.climate.airQuality.ozoneLevel ?? 'Low'} />
                                  <CrimeBar label="Pollen" level={review.climate.airQuality.pollenLevel ?? 'Low'} />
                                  <CrimeBar label="Industrial pollution" level={review.climate.airQuality.industrialPollutionLevel ?? 'Low'} />
                                  <CrimeBar label="Overall" level={review.climate.airQuality.overallRating ?? 'Low'} />
                                </div>
                              </div>
                              <p className="noise-summary">{review.climate.airQuality.overallSummary}</p>
                            </div>
                            <div className="noise-factors">
                              {([
                                { icon: '🌫', label: 'Particulate matter', value: review.climate.airQuality.particulateMatter },
                                { icon: '🌤', label: 'Ozone', value: review.climate.airQuality.ozone },
                                { icon: '🌿', label: 'Pollen', value: review.climate.airQuality.pollen },
                                { icon: '🏭', label: 'Industrial pollution', value: review.climate.airQuality.industrialPollution },
                              ] as const).map(({ icon, label, value }) => (
                                <div key={label} className="noise-factor-row">
                                  <span className="noise-factor-icon">{icon}</span>
                                  <div>
                                    <span className="noise-factor-label">{label}</span>
                                    <p className="noise-factor-value">{value}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                      {review.climate.noise && (
                        <div className="environment-section">
                          <p className="eyebrow">Noise & Amenity</p>
                         <div className="noise-panel">
                            <div className="noise-rating-card">
                              <div className="crime-chart-card noise-bars-card">
                                <h3>Noise level by source</h3>
                                <div className="crime-bars">
                                  <CrimeBar label="Flight paths" level={review.climate.noise.flightPathLevel ?? 'Low'} />
                                  <CrimeBar label="Rail noise" level={review.climate.noise.railNoiseLevel ?? 'Low'} />
                                  <CrimeBar label="Road noise" level={review.climate.noise.roadNoiseLevel ?? 'Low'} />
                                  <CrimeBar label="Industrial zones" level={review.climate.noise.industrialZonesLevel ?? 'Low'} />
                                  <CrimeBar label="Overall" level={review.climate.noise.overallRating ?? 'Low'} />
                                </div>
                              </div>
                              <p className="noise-summary">{review.climate.noise.overallSummary}</p>
                            </div>
                            <div className="noise-factors">
                              {([
                                { icon: '✈', label: 'Flight paths', value: review.climate.noise.flightPath },
                                { icon: '🚆', label: 'Rail noise', value: review.climate.noise.railNoise },
                                { icon: '🛣', label: 'Road noise', value: review.climate.noise.roadNoise },
                                { icon: '🏭', label: 'Industrial zones', value: review.climate.noise.industrialZones },
                              ] as const).map(({ icon, label, value }) => (
                                <div key={label} className="noise-factor-row">
                                  <span className="noise-factor-icon">{icon}</span>
                                  <div>
                                    <span className="noise-factor-label">{label}</span>
                                    <p className="noise-factor-value">{value}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                         </div>
                       </div>
                     )}
                   </section>
                 )}

                {activeTab === 'crime' && (
                  <section className="tab-panel safety-panel">
                    <div className="safety-narrative">
                      <h3>Crime & Safety Analysis</h3>
                      <p>{review.crime.narrative}</p>
                    </div>
                    {review.crime.crimeTypes?.length ? (
                      <div className="crime-chart-card">
                        <h3>Crime type levels</h3>
                        <div className="crime-bars">
                          {review.crime.crimeTypes.map((ct) => (
                            <CrimeBar key={ct.label} label={ct.label} level={ct.level} />
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {(review.crime.insuranceImpact || review.crime.estimatedAnnualPremiums) && (
                      <div className="insurance-card">
                        <h3>Insurance & Risk</h3>
                        {review.crime.insuranceImpact && <p>{review.crime.insuranceImpact}</p>}
                        {review.crime.estimatedAnnualPremiums && (
                          <div className="insurance-premiums">
                            {review.crime.estimatedAnnualPremiums.homeBuilding && (
                              <div className="insurance-premium-item">
                                <span>Home building</span>
                                <strong>{review.crime.estimatedAnnualPremiums.homeBuilding}</strong>
                              </div>
                            )}
                            {review.crime.estimatedAnnualPremiums.homeContents && (
                              <div className="insurance-premium-item">
                                <span>Home contents</span>
                                <strong>{review.crime.estimatedAnnualPremiums.homeContents}</strong>
                              </div>
                            )}
                            {review.crime.estimatedAnnualPremiums.carComprehensive && (
                              <div className="insurance-premium-item">
                                <span>Car (comprehensive)</span>
                                <strong>{review.crime.estimatedAnnualPremiums.carComprehensive}</strong>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </section>
                )}

                 {activeTab === 'infrastructure' && (() => {
                   const stateKey = review.state.toUpperCase() as AustralianState
                   const cbd = STATE_CBD[stateKey]
                   const pt = STATE_PT_URLS[stateKey]
                   const straightLineKm = (review.infrastructure.suburbLat != null && review.infrastructure.suburbLng != null && cbd)
                     ? Math.round(haversineKm(review.infrastructure.suburbLat, review.infrastructure.suburbLng, cbd.lat, cbd.lng) * 10) / 10
                     : review.infrastructure.cbdDistanceKm ?? null
                   const mapsDirectionsUrl = cbd
                     ? `https://www.google.com/maps/dir/${encodeURIComponent(`${review.suburb} ${review.state}`)}/${cbd.mapsQuery}`
                     : null
                   const totalSchools = (review.infrastructure.primarySchools ?? 0) + (review.infrastructure.secondarySchools ?? 0)

                   return (
                   <section className="tab-panel infra-panel">
                     {/* Stat chips row */}
                     <div className="infra-stats-row">
                       {/* CBD distance — straight-line, links to Google Maps */}
                       {straightLineKm != null && (
                         <a
                           className="infra-stat infra-stat-link"
                           href={mapsDirectionsUrl ?? '#'}
                           target="_blank" rel="noreferrer"
                           title={`Straight-line distance to ${cbd?.name ?? 'CBD'} — open in Google Maps`}
                         >
                           <span className="infra-stat-icon">📍</span>
                           <strong>{straightLineKm} km</strong>
                           <span>to {cbd?.name ?? 'CBD'}</span>
                           <span className="infra-stat-sublabel">straight-line</span>
                         </a>
                       )}
                       {/* Commute time */}
                       {review.infrastructure.cbdCommuteMinutes != null && (
                         <div className="infra-stat">
                           <span className="infra-stat-icon">⏱</span>
                           <strong>{review.infrastructure.cbdCommuteMinutes} min</strong>
                           <span>est. commute</span>
                         </div>
                       )}
                       {/* Bus — links to PT authority */}
                       {review.infrastructure.busAvailability && (
                         <a className="infra-stat infra-stat-link" href={pt?.bus ?? pt?.train ?? '#'} target="_blank" rel="noreferrer" title={`${pt?.label ?? 'Public transport'} bus routes`}>
                           <span className="infra-stat-icon">🚌</span>
                           <strong>{review.infrastructure.busAvailability}</strong>
                           <span>bus access</span>
                         </a>
                       )}
                       {/* Train stations — links to PT authority */}
                       {review.infrastructure.trainStations && review.infrastructure.trainStations.length > 0 && (
                         <a className="infra-stat infra-stat-link" href={pt?.train ?? '#'} target="_blank" rel="noreferrer" title={`${pt?.label ?? 'Public transport'} train routes`}>
                           <span className="infra-stat-icon">🚉</span>
                           <strong>{review.infrastructure.trainStations.length}</strong>
                           <span>train station{review.infrastructure.trainStations.length !== 1 ? 's' : ''}</span>
                         </a>
                       )}
                       {/* Tram — links to PT authority */}
                       {review.infrastructure.tramStops && (
                         <a className="infra-stat infra-stat-link" href={pt?.tram ?? pt?.train ?? '#'} target="_blank" rel="noreferrer" title={`${pt?.label ?? 'Public transport'} tram routes`}>
                           <span className="infra-stat-icon">🚋</span>
                           <strong>Tram</strong>
                           <span>access</span>
                         </a>
                       )}
                       {/* Schools */}
                       {totalSchools > 0 && (
                         <div className="infra-stat">
                           <span className="infra-stat-icon">🏫</span>
                           <strong>{totalSchools}</strong>
                           <span>school{totalSchools !== 1 ? 's' : ''}</span>
                           {review.infrastructure.primarySchools != null && review.infrastructure.secondarySchools != null && (
                             <span className="infra-stat-sublabel">{review.infrastructure.primarySchools} primary · {review.infrastructure.secondarySchools} secondary</span>
                           )}
                         </div>
                       )}
                       {/* Shopping precincts */}
                       {review.infrastructure.shoppingPrecincts != null && review.infrastructure.shoppingPrecincts > 0 && (
                         <div className="infra-stat">
                           <span className="infra-stat-icon">🛍</span>
                           <strong>{review.infrastructure.shoppingPrecincts}</strong>
                           <span>shopping precinct{review.infrastructure.shoppingPrecincts !== 1 ? 's' : ''}</span>
                         </div>
                       )}
                       {/* Parks */}
                       {review.infrastructure.parks != null && review.infrastructure.parks > 0 && (
                         <div className="infra-stat">
                           <span className="infra-stat-icon">🌳</span>
                           <strong>{review.infrastructure.parks}</strong>
                           <span>park{review.infrastructure.parks !== 1 ? 's' : ''}</span>
                         </div>
                       )}
                       {/* Medical centres */}
                       {review.infrastructure.medicalCentres != null && review.infrastructure.medicalCentres > 0 && (
                         <div className="infra-stat">
                           <span className="infra-stat-icon">🏥</span>
                           <strong>{review.infrastructure.medicalCentres}</strong>
                           <span>medical centre{review.infrastructure.medicalCentres !== 1 ? 's' : ''}</span>
                         </div>
                       )}
                       {/* Other POIs */}
                       {review.infrastructure.pointsOfInterest?.map((poi) => (
                         <div key={poi.label} className="infra-stat">
                           <span className="infra-stat-icon">{poi.icon}</span>
                           <strong className="infra-stat-poi-label">{poi.label}</strong>
                         </div>
                       ))}
                     </div>

                     {/* Train station names inline under the stat chips */}
                     {review.infrastructure.trainStations && review.infrastructure.trainStations.length > 0 && (
                       <div className="infra-station-list infra-station-list-inline">
                         {review.infrastructure.trainStations.map((st) => (
                           <div key={st.name} className="infra-station-row">
                             <span className="infra-station-name">🚉 {st.name}</span>
                             <span className="infra-station-lines">{st.lines}</span>
                           </div>
                         ))}
                         {review.infrastructure.tramStops && (
                           <div className="infra-station-row">
                             <span className="infra-station-name">🚋 Tram stops</span>
                             <span className="infra-station-lines">{review.infrastructure.tramStops}</span>
                           </div>
                         )}
                       </div>
                     )}

                     {/* Major roads */}
                     {review.infrastructure.majorRoads && review.infrastructure.majorRoads.length > 0 && (
                       <div className="infra-card">
                         <h3>Major Roads & Freeways</h3>
                         <ul className="infra-roads-list">
                           {review.infrastructure.majorRoads.map((road) => (
                             <li key={road}>{road}</li>
                           ))}
                         </ul>
                       </div>
                     )}

                     {/* Narrative cards */}
                     <div className="infra-narrative-grid">
                       <div className="infra-card">
                         <h3>Transit & Commute</h3>
                         <p>{review.infrastructure.transit}</p>
                       </div>
                       <div className="infra-card">
                         <h3>Education & Catchments</h3>
                         <p>{review.infrastructure.education}</p>
                       </div>
                       <div className="infra-card">
                         <h3>Lifestyle & Amenities</h3>
                         <p>{review.infrastructure.lifestyle}</p>
                       </div>
                     </div>
                    </section>
                   )
                  })()}

                 {activeTab === 'demographics' && (
                  <section className="tab-panel demographic-panel">
                    <div className="demographic-copy">
                      <p className="eyebrow">Resident profile</p>
                      <h3>Demographic snapshot</h3>
                      <p>{demographicSummary}</p>
                      <div className="demographic-stats">
                        {review.demographics?.population && (
                          <div>
                            <span>Population</span>
                            <strong>{review.demographics.population}</strong>
                          </div>
                        )}
                        {review.demographics?.medianAge && (
                          <div>
                            <span>Median age</span>
                            <strong>{review.demographics.medianAge}</strong>
                          </div>
                        )}
                      </div>
                    </div>
                    <DemographicPieChart
                      title={review.demographics?.ageGroups?.length ? 'Age profile' : 'Household mix'}
                      data={primaryDemographicData}
                    />
                    {review.demographics?.tenureTypes?.length ? (
                      <DemographicPieChart title="Housing tenure" data={review.demographics.tenureTypes} />
                    ) : null}
                    {review.demographics?.countryOfOrigin?.length ? (
                      <DemographicPieChart title="Country of origin" data={review.demographics.countryOfOrigin} />
                    ) : null}
                  </section>
                )}

                {activeTab === 'map' && (
                  <section className="tab-panel map-panel">
                    <div className="map-copy">
                      <div>
                        <h3>Map location</h3>
                        <p>
                          Explore {review.suburb}, {review.state} in Google Maps.
                        </p>
                      </div>
                      <a className="map-open-link" href={toGoogleMapsUrl(review)} target="_blank" rel="noreferrer">
                        Open in Google Maps
                      </a>
                    </div>
                    <div className="map-frame-wrap">
                      <iframe
                        title={`${review.suburb}, ${review.state} map`}
                        src={toGoogleMapsEmbedUrl(review)}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        allowFullScreen
                      />
                    </div>
                  </section>
                )}
              </>
            )}

            {!locationNotFound && review.caveats?.length > 0 && (
              <section className="caveats">
                <h3>Caveats</h3>
                <ul>
                  {review.caveats.map((caveat) => (
                    <li key={caveat}>{caveat}</li>
                  ))}
                </ul>
              </section>
            )}
          </article>

        </section>
      )}

      {!review && !isLoading && (
        <section className="empty-state">
          <div>
            <h2>Make a smarter move with a clearer view.</h2>
          </div>
        </section>
      )}

      <footer className="site-footer">
        <p>© {new Date().getFullYear()} Michael Soutar</p>
      </footer>
    </main>
  )
}

export default App

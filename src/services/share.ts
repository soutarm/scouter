import { decompressFromEncodedURIComponent } from 'lz-string'

import type { DemographicDatum, MarketRow, Review, ReviewScores } from '../types'

// ---------------------------------------------------------------------------
// Worker URL - set via Vite env var at build time, falls back to prod URL
// ---------------------------------------------------------------------------
export const WORKER_BASE_URL =
  (import.meta.env.VITE_WORKER_URL as string | undefined)?.replace(/\/$/, '') ??
  'https://scouter-reviews.soutarm.workers.dev'

// ---------------------------------------------------------------------------
// Legacy hash-based key (kept for backwards-compat decoding of old links)
// ---------------------------------------------------------------------------
export const SHARED_REVIEW_HASH_KEY = 'r'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SharedReviewPayload = {
  suburb: string
  state: string
  sourceProvider?: Review['sourceProvider']
  sourceModel?: string
  generatedAt: string
  summary: string
  scores?: ReviewScores
  briefs?: Review['briefs']
  marketRows: MarketRow[]
  marketNarrative?: string
  stateMedianGrowth?: string
  capitalCityGrowth?: string
  stateMedianGrowth5yr?: string
  capitalCityGrowth5yr?: string
  climate: Review['climate']
  crime: {
    narrative?: string
    insuranceImpact?: string
    crimeTypes?: Array<{ label: string; level: 'Low' | 'Medium' | 'High' | 'Very High' }>
    estimatedAnnualPremiums?: Review['crime']['estimatedAnnualPremiums']
  }
  infrastructure: {
    transit?: string
    education?: string
    lifestyle?: string
    trainStations?: Review['infrastructure']['trainStations']
    tramStops?: string
    busAvailability?: Review['infrastructure']['busAvailability']
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
    pointsOfInterest?: Review['infrastructure']['pointsOfInterest']
  }
  demographics?: {
    summary?: string
    population?: string
    medianAge?: string
    householdTypes?: DemographicDatum[]
    ageGroups?: DemographicDatum[]
    tenureTypes?: DemographicDatum[]
    countryOfOrigin?: DemographicDatum[]
    residentProfiles?: DemographicDatum[]
    religion?: DemographicDatum[]
  }
  caveats?: string[]
  briefCaveats?: string[]
  references?: string[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const clampScore = (value: unknown): number => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0
  const rounded = Math.round(value * 10) / 10
  return Math.min(10, Math.max(0, rounded))
}

const sanitizeScores = (value: unknown): ReviewScores | undefined => {
  if (!isObject(value)) return undefined
  return {
    overall: clampScore(value.overall),
    property: clampScore(value.property),
    safety: clampScore(value.safety),
    infrastructure: clampScore(value.infrastructure),
    environment: clampScore(value.environment),
  }
}

// ---------------------------------------------------------------------------
// Serialize a full review to the shared payload shape
// ---------------------------------------------------------------------------

const toSharedPayload = (review: Review): SharedReviewPayload => ({
  suburb: review.suburb,
  state: review.state,
  sourceProvider: review.sourceProvider,
  sourceModel: review.sourceModel,
  generatedAt: review.generatedAt,
  summary: review.summary,
  scores: review.scores,
  briefs: review.briefs,
  marketRows: review.marketRows,
  marketNarrative: review.marketNarrative,
  stateMedianGrowth: review.stateMedianGrowth,
  capitalCityGrowth: review.capitalCityGrowth,
  stateMedianGrowth5yr: review.stateMedianGrowth5yr,
  capitalCityGrowth5yr: review.capitalCityGrowth5yr,
  climate: review.climate,
  crime: {
    narrative: review.crime.narrative,
    insuranceImpact: review.crime.insuranceImpact,
    crimeTypes: review.crime.crimeTypes,
    estimatedAnnualPremiums: review.crime.estimatedAnnualPremiums,
  },
  infrastructure: {
    transit: review.infrastructure.transit,
    education: review.infrastructure.education,
    lifestyle: review.infrastructure.lifestyle,
    trainStations: review.infrastructure.trainStations,
    tramStops: review.infrastructure.tramStops,
    busAvailability: review.infrastructure.busAvailability,
    majorRoads: review.infrastructure.majorRoads,
    cbdDistanceKm: review.infrastructure.cbdDistanceKm,
    cbdCommuteMinutes: review.infrastructure.cbdCommuteMinutes,
    suburbLat: review.infrastructure.suburbLat,
    suburbLng: review.infrastructure.suburbLng,
    primarySchools: review.infrastructure.primarySchools,
    secondarySchools: review.infrastructure.secondarySchools,
    shoppingPrecincts: review.infrastructure.shoppingPrecincts,
    parks: review.infrastructure.parks,
    medicalCentres: review.infrastructure.medicalCentres,
    pointsOfInterest: review.infrastructure.pointsOfInterest,
  },
  demographics: review.demographics
    ? {
      summary: review.demographics.summary,
      population: review.demographics.population,
      medianAge: review.demographics.medianAge,
      householdTypes: review.demographics.householdTypes,
      ageGroups: review.demographics.ageGroups,
      tenureTypes: review.demographics.tenureTypes,
      countryOfOrigin: review.demographics.countryOfOrigin,
      residentProfiles: review.demographics.residentProfiles,
      religion: review.demographics.religion,
    }
    : undefined,
  caveats: review.caveats,
  briefCaveats: review.briefCaveats,
  references: review.references,
})

// ---------------------------------------------------------------------------
// Deserialize payload back to a Review
// ---------------------------------------------------------------------------

const toReview = (payload: SharedReviewPayload): Review => ({
  exists: true,
  suburb: payload.suburb,
  state: payload.state,
  sourceProvider: payload.sourceProvider,
  sourceModel: payload.sourceModel,
  generatedAt: payload.generatedAt,
  summary: payload.summary,
  briefs: payload.briefs,
  scores: sanitizeScores(payload.scores),
  marketNarrative: payload.marketNarrative ?? '',
  marketRows: Array.isArray(payload.marketRows) ? payload.marketRows : [],
  stateMedianGrowth: payload.stateMedianGrowth,
  capitalCityGrowth: payload.capitalCityGrowth,
  stateMedianGrowth5yr: payload.stateMedianGrowth5yr,
  capitalCityGrowth5yr: payload.capitalCityGrowth5yr,
  climate: payload.climate ?? { summerAverages: '', winterAverages: '' },
  crime: {
    narrative: payload.crime?.narrative ?? '',
    insuranceImpact: payload.crime?.insuranceImpact ?? '',
    estimatedAnnualPremiums: payload.crime?.estimatedAnnualPremiums,
    crimeTypes: payload.crime?.crimeTypes,
  },
  infrastructure: {
    transit: payload.infrastructure?.transit ?? '',
    education: payload.infrastructure?.education ?? '',
    lifestyle: payload.infrastructure?.lifestyle ?? '',
    demographic: '',
    trainStations: payload.infrastructure?.trainStations,
    tramStops: payload.infrastructure?.tramStops,
    busAvailability: payload.infrastructure?.busAvailability,
    majorRoads: payload.infrastructure?.majorRoads,
    cbdDistanceKm: payload.infrastructure?.cbdDistanceKm,
    cbdCommuteMinutes: payload.infrastructure?.cbdCommuteMinutes,
    suburbLat: payload.infrastructure?.suburbLat,
    suburbLng: payload.infrastructure?.suburbLng,
    primarySchools: payload.infrastructure?.primarySchools,
    secondarySchools: payload.infrastructure?.secondarySchools,
    shoppingPrecincts: payload.infrastructure?.shoppingPrecincts,
    parks: payload.infrastructure?.parks,
    medicalCentres: payload.infrastructure?.medicalCentres,
    pointsOfInterest: payload.infrastructure?.pointsOfInterest,
  },
  demographics: payload.demographics
    ? {
      summary: payload.demographics.summary ?? '',
      population: payload.demographics.population,
      medianAge: payload.demographics.medianAge,
      householdTypes: payload.demographics.householdTypes,
      ageGroups: payload.demographics.ageGroups,
      tenureTypes: payload.demographics.tenureTypes,
      countryOfOrigin: payload.demographics.countryOfOrigin,
      residentProfiles: payload.demographics.residentProfiles,
      religion: payload.demographics.religion,
    }
    : undefined,
  caveats: payload.caveats ?? [],
  briefCaveats: payload.briefCaveats,
  references: payload.references,
})

// ---------------------------------------------------------------------------
// Worker-backed share: POST review → get short ID
// ---------------------------------------------------------------------------

export const storeReview = async (review: Review): Promise<string> => {
  const payload = JSON.stringify(toSharedPayload(review))
  const res = await fetch(`${WORKER_BASE_URL}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to store review: ${res.status} ${text.slice(0, 120)}`)
  }
  const data = await res.json() as { id?: string }
  if (!data.id) throw new Error('Worker returned no ID')
  return data.id
}

export const fetchReviewById = async (id: string): Promise<Review | null> => {
  try {
    const res = await fetch(`${WORKER_BASE_URL}/reviews/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
    const payload = await res.json() as SharedReviewPayload
    if (!payload?.suburb || !payload?.state || !payload?.summary) return null
    return toReview(payload)
  } catch {
    return null
  }
}

export const buildShareUrl = (id: string): string => {
  const url = new URL(`/r/${encodeURIComponent(id)}`, window.location.origin)
  url.search = ''
  url.hash = ''
  return url.toString()
}

// ---------------------------------------------------------------------------
// Legacy hash-based decode (backwards compat for old shared links)
// ---------------------------------------------------------------------------

export const decodeSharedReview = (encoded: string): Review | null => {
  const decoded = decompressFromEncodedURIComponent(encoded)
  if (!decoded) return null
  try {
    const parsed = JSON.parse(decoded) as SharedReviewPayload
    if (!parsed?.suburb || !parsed?.state || !parsed?.summary || !parsed?.generatedAt || !parsed?.climate || !parsed?.infrastructure) {
      return null
    }
    return toReview(parsed)
  } catch {
    return null
  }
}

export const getSharedReviewFromHash = (hash: string): Review | null => {
  const rawHash = hash.startsWith('#') ? hash.slice(1) : hash
  const params = new URLSearchParams(rawHash)
  const encoded = params.get(SHARED_REVIEW_HASH_KEY)
  if (!encoded) return null
  return decodeSharedReview(encoded)
}

export const clearSharedReviewHash = () => {
  if (!window.location.hash) return
  const params = new URLSearchParams(window.location.hash.slice(1))
  params.delete(SHARED_REVIEW_HASH_KEY)
  const nextHash = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ''}`,
  )
}

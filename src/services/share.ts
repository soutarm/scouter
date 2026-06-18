import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'

import type { DemographicDatum, MarketRow, Review, ReviewScores } from '../types'

export const SHARED_REVIEW_HASH_KEY = 'r'

type SharedReviewPayload = {
  suburb: string
  state: string
  generatedAt: string
  summary: string
  scores?: ReviewScores
  briefs?: Review['briefs']
  marketRows: MarketRow[]
  stateMedianGrowth?: string
  capitalCityGrowth?: string
  climate: Review['climate']
  crime: {
    crimeTypes?: Array<{ label: string; level: 'Low' | 'Medium' | 'High' | 'Very High' }>
    estimatedAnnualPremiums?: Review['crime']['estimatedAnnualPremiums']
  }
  infrastructure: {
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
    population?: string
    medianAge?: string
    householdTypes?: DemographicDatum[]
    ageGroups?: DemographicDatum[]
    tenureTypes?: DemographicDatum[]
    countryOfOrigin?: DemographicDatum[]
    residentProfiles?: DemographicDatum[]
  }
  caveats?: string[]
  briefCaveats?: string[]
  references?: string[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

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

const toSharedPayload = (review: Review): SharedReviewPayload => ({
  suburb: review.suburb,
  state: review.state,
  generatedAt: review.generatedAt,
  summary: review.summary,
  scores: review.scores,
  briefs: review.briefs,
  marketRows: review.marketRows,
  stateMedianGrowth: review.stateMedianGrowth,
  capitalCityGrowth: review.capitalCityGrowth,
  climate: review.climate,
  crime: {
    crimeTypes: review.crime.crimeTypes,
    estimatedAnnualPremiums: review.crime.estimatedAnnualPremiums,
  },
  infrastructure: {
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
      population: review.demographics.population,
      medianAge: review.demographics.medianAge,
      householdTypes: review.demographics.householdTypes,
      ageGroups: review.demographics.ageGroups,
      tenureTypes: review.demographics.tenureTypes,
      countryOfOrigin: review.demographics.countryOfOrigin,
      residentProfiles: review.demographics.residentProfiles,
    }
    : undefined,
  caveats: review.caveats,
  briefCaveats: review.briefCaveats,
  references: review.references,
})

export const encodeSharedReview = (review: Review): string => {
  const payload = JSON.stringify(toSharedPayload(review))
  return compressToEncodedURIComponent(payload)
}

export const buildShareUrl = (review: Review): string => {
  const encoded = encodeSharedReview(review)
  const origin = window.location.origin
  const pathname = window.location.pathname
  return `${origin}${pathname}#${SHARED_REVIEW_HASH_KEY}=${encoded}`
}

const toReview = (payload: SharedReviewPayload): Review => ({
  exists: true,
  suburb: payload.suburb,
  state: payload.state,
  generatedAt: payload.generatedAt,
  summary: payload.summary,
  briefs: payload.briefs,
  scores: sanitizeScores(payload.scores),
  marketNarrative: '',
  marketRows: Array.isArray(payload.marketRows) ? payload.marketRows : [],
  stateMedianGrowth: payload.stateMedianGrowth,
  capitalCityGrowth: payload.capitalCityGrowth,
  climate: payload.climate ?? {
    summerAverages: '',
    winterAverages: '',
  },
  crime: {
    narrative: '',
    insuranceImpact: '',
    estimatedAnnualPremiums: payload.crime?.estimatedAnnualPremiums,
    crimeTypes: payload.crime?.crimeTypes,
  },
  infrastructure: {
    transit: '',
    education: '',
    lifestyle: '',
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
      summary: '',
      population: payload.demographics.population,
      medianAge: payload.demographics.medianAge,
      householdTypes: payload.demographics.householdTypes,
      ageGroups: payload.demographics.ageGroups,
      tenureTypes: payload.demographics.tenureTypes,
      countryOfOrigin: payload.demographics.countryOfOrigin,
      residentProfiles: payload.demographics.residentProfiles,
    }
    : undefined,
  caveats: payload.caveats ?? [],
  briefCaveats: payload.briefCaveats,
  references: payload.references,
})

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

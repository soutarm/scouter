export type ProviderKind = 'free' | 'azure' | 'openai' | 'gemini' | 'anthropic'

export type StateBenchmark = {
  /** 12-month annual dwelling price growth % */
  annual12m: number
  /** 5-year cumulative dwelling price growth % */
  cumulative5yr: number
}

export type StateBenchmarks = {
  /** ISO timestamp when these benchmarks were fetched */
  fetchedAt: string
  /** Source description shown in UI */
  source: string
  states: Record<string, StateBenchmark>
}

export type LlmSettings = {
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
  anthropicModel: string
  anthropicApiKey: string
}

export type ReviewSectionKey = 'property' | 'environment' | 'crime' | 'infrastructure' | 'demographics' | 'map'

export type DemographicDatum = {
  label: string
  value: number
}

export type MarketRow = {
  propertyType: string
  medianPrice: string
  twelveMonthGrowth: string
  fiveYearGrowth?: string
  medianWeeklyRent: string
  grossYield: string
  councilRates?: string
}

export type SuburbSuggestion = {
  name: string
  state: AustralianState
  postcode: string
}

export type ReviewScores = {
  overall: number        // computed client-side: average of the four sub-scores
  property: number       // based on 12-month growth rates
  safety: number         // based on crime type levels (Assault/B&E weighted 2x)
  infrastructure: number // based on transit/services/amenity buckets
  environment: number    // based on air quality + noise levels (50/50)
}

export type Review = {
  exists?: boolean
  sourceProvider?: ProviderKind
  sourceModel?: string
  suburb: string
  state: string
  postcode?: string
  generatedAt: string
  summary: string
  briefs?: {
    market?: string
    environment?: string
    crime?: string
    infrastructure?: string
  }
  scores?: ReviewScores
  notFoundReason?: string
  suggestedSuburb?: string
  suggestedState?: string
  marketNarrative: string
  marketRows: MarketRow[]
  stateMedianGrowth?: string
  capitalCityGrowth?: string
  stateMedianGrowth5yr?: string
  capitalCityGrowth5yr?: string
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
    wind?: {
      overallRating: 'Low' | 'Medium' | 'High' | 'Very High'
      overallSummary: string
      predominantDirection: string
      averageSpeedKmh: number
      seasonalVariation: string
      directions: Array<{ direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'; frequency: number; avgSpeedKmh: number }>
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
    naturalRisks?: Array<{ label: string; level: 'Low' | 'Medium' | 'High' | 'Very High'; note?: string }>
  }
  infrastructure: {
    transit: string
    education: string
    lifestyle: string
    demographic: string
    trainStations?: Array<{ name: string; lines: string; distanceKm?: number }>
    tramStops?: string
    busAvailability?: 'Excellent' | 'Good' | 'Limited' | 'None'
    majorRoads?: string[]
    cbdDistanceKm?: number
    cbdCommuteMinutes?: number
    suburbLat?: number
    suburbLng?: number
    primarySchools?: number
    primarySchoolNames?: string[]
    secondarySchools?: number
    secondarySchoolNames?: string[]
    shoppingPrecincts?: number
    shoppingPrecinctNames?: string[]
    parks?: number
    parkNames?: string[]
    medicalCentres?: number
    medicalCentreNames?: string[]
    restaurants?: number
    restaurantNames?: string[]
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
    residentProfiles?: DemographicDatum[]
    religion?: DemographicDatum[]
    householdIncome?: DemographicDatum[]
  }
  caveats: string[]
  briefCaveats?: string[]
  references?: string[]
}

export const australianStates = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const
export type AustralianState = (typeof australianStates)[number]

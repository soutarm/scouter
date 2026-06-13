export type ProviderKind = 'azure' | 'openai' | 'gemini'

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
  medianWeeklyRent: string
  grossYield: string
}

export type SuburbSuggestion = {
  name: string
  state: AustralianState
  postcode: string
}

export type ReviewScores = {
  overall: number        // computed client-side: average of the five sub-scores
  property: number
  safety: number
  infrastructure: number
  demographics: number
  environment: number
}

export type Review = {
  exists?: boolean
  suburb: string
  state: string
  postcode?: string
  generatedAt: string
  summary: string
  scores?: ReviewScores
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
    residentProfiles?: DemographicDatum[]
  }
  caveats: string[]
  references?: string[]
}

export const australianStates = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const
export type AustralianState = (typeof australianStates)[number]

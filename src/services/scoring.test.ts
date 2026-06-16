import { describe, it, expect } from 'vitest'
import {
  computePropertyScore,
  computeSafetyScore,
  computeInfrastructureScore,
  computeEnvironmentScore,
  computeClimateScore,
  computeScores,
} from './scoring'
import type { Review } from '../types'

// ── Minimal review fixture ────────────────────────────────────────────────────

const baseReview: Review = {
  exists: true,
  suburb: 'Testville',
  state: 'VIC',
  generatedAt: '2026-01-01T00:00:00Z',
  summary: 'A test suburb.',
  marketNarrative: '',
  marketRows: [],
  climate: { summerAverages: '', winterAverages: '' },
  crime: { narrative: '', insuranceImpact: '' },
  infrastructure: { transit: '', education: '', lifestyle: '', demographic: '' },
  caveats: [],
}

// ── Property score ────────────────────────────────────────────────────────────

describe('computePropertyScore', () => {
  it('returns neutral 5 when no market rows', () => {
    expect(computePropertyScore(baseReview)).toBe(5)
  })

  // ── Relative mode (stateMedianGrowth present) ──────────────────────────────

  it('relative: suburb at state average → 5', () => {
    const r = { ...baseReview,
      stateMedianGrowth: '+2.5%',
      marketRows: [{ propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '+2.5%', medianWeeklyRent: '$450', grossYield: '3%' }],
    }
    expect(computePropertyScore(r)).toBe(5)
  })

  it('relative: +7.5pp above state average → 9.5 (clamp to 10 only beyond)', () => {
    // score = 5 + (7.5/7.5)*4.5 = 9.5
    const r = { ...baseReview,
      stateMedianGrowth: '+2.5%',
      marketRows: [{ propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '+10%', medianWeeklyRent: '$450', grossYield: '3%' }],
    }
    expect(computePropertyScore(r)).toBeCloseTo(9.5, 1)
  })

  it('relative: ≥+7.5pp above state average clamps to 10', () => {
    const r = { ...baseReview,
      stateMedianGrowth: '+2.5%',
      marketRows: [{ propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '+20%', medianWeeklyRent: '$450', grossYield: '3%' }],
    }
    expect(computePropertyScore(r)).toBe(10)
  })

  it('relative: -7.5pp below state average → 0.5 (clamps to 1)', () => {
    const r = { ...baseReview,
      stateMedianGrowth: '+2.5%',
      marketRows: [{ propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '-5%', medianWeeklyRent: '$450', grossYield: '3%' }],
    }
    expect(computePropertyScore(r)).toBe(1)
  })

  it('relative: +3pp above state average → 6.8', () => {
    // score = 5 + (3/7.5)*4.5 = 5 + 1.8 = 6.8
    const r = { ...baseReview,
      stateMedianGrowth: '+2%',
      marketRows: [{ propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '+5%', medianWeeklyRent: '$450', grossYield: '3%' }],
    }
    expect(computePropertyScore(r)).toBeCloseTo(6.8, 1)
  })

  it('relative: clamps below 1 when far below average', () => {
    const r = { ...baseReview,
      stateMedianGrowth: '+5%',
      marketRows: [{ propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '-20%', medianWeeklyRent: '$450', grossYield: '3%' }],
    }
    expect(computePropertyScore(r)).toBe(1)
  })

  // ── Fallback mode (no stateMedianGrowth) ──────────────────────────────────

  it('fallback: scores 10 at 10% growth', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$800k', twelveMonthGrowth: '+10%', medianWeeklyRent: '$500', grossYield: '3%' },
    ] }
    expect(computePropertyScore(r)).toBe(10)
  })

  it('fallback: scores 1 at -5% growth', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$500k', twelveMonthGrowth: '-5%', medianWeeklyRent: '$400', grossYield: '4%' },
    ] }
    expect(computePropertyScore(r)).toBe(1)
  })

  it('fallback: averages both rows', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$800k', twelveMonthGrowth: '+10%', medianWeeklyRent: '$500', grossYield: '3%' },
      { propertyType: 'Units', medianPrice: '$500k', twelveMonthGrowth: '-5%', medianWeeklyRent: '$400', grossYield: '4%' },
    ] }
    // avg=2.5% → 1+(2.5+5)/15*9 = 5.5
    expect(computePropertyScore(r)).toBe(5.5)
  })

  it('fallback: handles growth without + sign', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '3%', medianWeeklyRent: '$450', grossYield: '3.5%' },
    ] }
    expect(computePropertyScore(r)).toBeCloseTo(5.8, 1)
  })
})

// ── Safety score ──────────────────────────────────────────────────────────────

describe('computeSafetyScore', () => {
  it('returns 5 when no crime types', () => {
    expect(computeSafetyScore(baseReview)).toBe(5)
  })

  it('returns 10 when all Low', () => {
    const r = { ...baseReview, crime: { ...baseReview.crime, crimeTypes: [
      { label: 'Theft', level: 'Low' as const },
      { label: 'Assault', level: 'Low' as const },
      { label: 'Break & Enter', level: 'Low' as const },
    ] } }
    expect(computeSafetyScore(r)).toBe(10)
  })

  it('returns 1 when all Very High', () => {
    const r = { ...baseReview, crime: { ...baseReview.crime, crimeTypes: [
      { label: 'Theft', level: 'Very High' as const },
      { label: 'Assault', level: 'Very High' as const },
      { label: 'Break & Enter', level: 'Very High' as const },
    ] } }
    expect(computeSafetyScore(r)).toBe(1)
  })

  it('weights Assault and Break & Enter at 2x', () => {
    // Theft=Low(10) w1, Assault=Very High(1) w2 → (10 + 2) / 3 = 4
    const r = { ...baseReview, crime: { ...baseReview.crime, crimeTypes: [
      { label: 'Theft', level: 'Low' as const },
      { label: 'Assault', level: 'Very High' as const },
    ] } }
    expect(computeSafetyScore(r)).toBeCloseTo(4, 1)
  })

  it('weights Vehicle theft at 1.5x', () => {
    // Theft=Low(10) w1, Vehicle theft=Very High(1) w1.5 → (10 + 1.5) / 2.5 = 4.6
    const r = { ...baseReview, crime: { ...baseReview.crime, crimeTypes: [
      { label: 'Theft', level: 'Low' as const },
      { label: 'Vehicle theft', level: 'Very High' as const },
    ] } }
    expect(computeSafetyScore(r)).toBeCloseTo(4.6, 1)
  })

  it('reproduces the 6-type example: all medium/low → ~7.9', () => {
    // Theft:M(5)×1 + Assault:L(10)×2 + B&E:L(10)×2 + Vandalism:M(5)×1 + Drug:L(10)×1 + VehicleTheft:M(5)×1.5
    // = 5+20+20+5+10+7.5 = 67.5 / (1+2+2+1+1+1.5) = 67.5/8.5 ≈ 7.9
    const r = { ...baseReview, crime: { ...baseReview.crime, crimeTypes: [
      { label: 'Theft', level: 'Medium' as const },
      { label: 'Assault', level: 'Low' as const },
      { label: 'Break & Enter', level: 'Low' as const },
      { label: 'Vandalism', level: 'Medium' as const },
      { label: 'Drug offences', level: 'Low' as const },
      { label: 'Vehicle theft', level: 'Medium' as const },
    ] } }
    expect(computeSafetyScore(r)).toBeCloseTo(7.9, 1)
  })
})

// ── Infrastructure score ──────────────────────────────────────────────────────

describe('computeInfrastructureScore', () => {
  it('returns ~4.2 when all data missing (medium tier default)', () => {
    // transit: no trains(0) + bus missing(5) = 2.5; services: 5; amenity: 5
    expect(computeInfrastructureScore(baseReview)).toBeCloseTo(4.2, 1)
  })

  it('floors services bucket at 3 when counts are all 0', () => {
    const r = { ...baseReview, infrastructure: {
      ...baseReview.infrastructure,
      primarySchools: 0,
      secondarySchools: 0,
      medicalCentres: 0,
      shoppingPrecincts: 0,
    } }
    expect(computeInfrastructureScore(r)).toBeCloseTo(3.5, 1)
  })

  it('small suburb: 1 train station scores 10 for transit train component', () => {
    const r = {
      ...baseReview,
      demographics: { summary: '', population: '4,000' },
      infrastructure: {
        ...baseReview.infrastructure,
        trainStations: [{ name: 'Local', lines: 'Regional' }],
        busAvailability: 'Good' as const,
      }
    }
    // small tier: 1 train → 10pts, bus Good → 7 → transit = (10+7)/2 = 8.5
    expect(computeInfrastructureScore(r)).toBeGreaterThan(6)
  })

  it('large suburb: 1 train station scores low for transit train component', () => {
    const r = {
      ...baseReview,
      demographics: { summary: '', population: '80,000' },
      infrastructure: {
        ...baseReview.infrastructure,
        trainStations: [{ name: 'One', lines: 'Metro' }],
        busAvailability: 'Good' as const,
      }
    }
    // large tier: 1 train → 2pts, bus Good → 7 → transit = (2+7)/2 = 4.5
    const small = {
      ...baseReview,
      demographics: { summary: '', population: '4,000' },
      infrastructure: {
        ...baseReview.infrastructure,
        trainStations: [{ name: 'One', lines: 'Metro' }],
        busAvailability: 'Good' as const,
      }
    }
    expect(computeInfrastructureScore(r)).toBeLessThan(computeInfrastructureScore(small))
  })

  it('medium suburb scores 10 with good all-round data', () => {
    const r = {
      ...baseReview,
      demographics: { summary: '', population: '20,000' },
      infrastructure: {
        ...baseReview.infrastructure,
        trainStations: [{ name: 'A', lines: 'X' }, { name: 'B', lines: 'Y' }, { name: 'C', lines: 'Z' }],
        busAvailability: 'Excellent' as const,
        primarySchools: 3,
        secondarySchools: 2,
        medicalCentres: 3,
        shoppingPrecincts: 3,
        parks: 5,
        pointsOfInterest: [1,2,3,4,5,6].map(i => ({ icon: '🏛', label: `POI ${i}` })),
      }
    }
    expect(computeInfrastructureScore(r)).toBe(10)
  })

  it('parses population strings: "~4,500", "12k", "80000"', () => {
    const make = (population: string) => ({
      ...baseReview,
      demographics: { summary: '', population },
      infrastructure: {
        ...baseReview.infrastructure,
        trainStations: [{ name: 'X', lines: 'Y' }],
      }
    })
    // ~4,500 → small → 1 station = 10 train pts
    // 12k → medium → 1 station = 4 train pts
    // 80000 → large → 1 station = 2 train pts
    const small = computeInfrastructureScore(make('~4,500'))
    const medium = computeInfrastructureScore(make('12k'))
    const large = computeInfrastructureScore(make('80000'))
    expect(small).toBeGreaterThan(medium)
    expect(medium).toBeGreaterThan(large)
  })
})

// ── Environment score ─────────────────────────────────────────────────────────

describe('computeEnvironmentScore', () => {
  it('returns 5 when no air quality, noise, climate or wind data', () => {
    expect(computeEnvironmentScore(baseReview)).toBe(5)
  })

  it('scores 7.5 when all Low air+noise, climate and wind missing (air=10, noise=10, climate=5, wind=5 → 7.5)', () => {
    const r = { ...baseReview,
      climate: {
        summerAverages: '', winterAverages: '',
        airQuality: {
          overallRating: 'Low' as const, overallSummary: '',
          particulateMatter: '', particulateMatterLevel: 'Low' as const,
          ozone: '', ozoneLevel: 'Low' as const,
          pollen: '', pollenLevel: 'Low' as const,
          industrialPollution: '', industrialPollutionLevel: 'Low' as const,
        },
        noise: {
          overallRating: 'Low' as const, overallSummary: '',
          flightPath: '', flightPathLevel: 'Low' as const,
          railNoise: '', railNoiseLevel: 'Low' as const,
          roadNoise: '', roadNoiseLevel: 'Low' as const,
          industrialZones: '', industrialZonesLevel: 'Low' as const,
        },
      }
    }
    // (10+10+5+5) / 4 = 7.5
    expect(computeEnvironmentScore(r)).toBeCloseTo(7.5, 1)
  })

  it('scores 2 when all Very High air+noise, climate and wind missing (air=1, noise=1, climate=5, wind=5 → 3)', () => {
    const r = { ...baseReview,
      climate: {
        summerAverages: '', winterAverages: '',
        airQuality: {
          overallRating: 'Very High' as const, overallSummary: '',
          particulateMatter: '', particulateMatterLevel: 'Very High' as const,
          ozone: '', ozoneLevel: 'Very High' as const,
          pollen: '', pollenLevel: 'Very High' as const,
          industrialPollution: '', industrialPollutionLevel: 'Very High' as const,
        },
        noise: {
          overallRating: 'Very High' as const, overallSummary: '',
          flightPath: '', flightPathLevel: 'Very High' as const,
          railNoise: '', railNoiseLevel: 'Very High' as const,
          roadNoise: '', roadNoiseLevel: 'Very High' as const,
          industrialZones: '', industrialZonesLevel: 'Very High' as const,
        },
      }
    }
    // (1+1+5+5) / 4 = 3
    expect(computeEnvironmentScore(r)).toBeCloseTo(3, 1)
  })

  it('returns 6.25 for all-Low air quality only, rest missing', () => {
    const r = { ...baseReview,
      climate: {
        summerAverages: '', winterAverages: '',
        airQuality: {
          overallRating: 'Low' as const, overallSummary: '',
          particulateMatter: '', particulateMatterLevel: 'Low' as const,
          ozone: '', ozoneLevel: 'Low' as const,
          pollen: '', pollenLevel: 'Low' as const,
          industrialPollution: '', industrialPollutionLevel: 'Low' as const,
        },
      }
    }
    // air=10, noise=5, climate=5, wind=5 → (10+5+5+5)/4 = 6.25
    expect(computeEnvironmentScore(r)).toBeCloseTo(6.3, 1)
  })

  it('wind Low rating scores 10 and boosts overall', () => {
    const r = { ...baseReview,
      climate: {
        summerAverages: '', winterAverages: '',
        wind: {
          overallRating: 'Low' as const,
          overallSummary: '', predominantDirection: 'N', averageSpeedKmh: 10,
          seasonalVariation: '',
          directions: [],
        }
      }
    }
    // air=5, noise=5, climate=5, wind=10 → 6.25
    expect(computeEnvironmentScore(r)).toBeCloseTo(6.3, 1)
  })

  it('wind Very High rating scores 1 and drags overall down', () => {
    const r = { ...baseReview,
      climate: {
        summerAverages: '', winterAverages: '',
        wind: {
          overallRating: 'Very High' as const,
          overallSummary: '', predominantDirection: 'SW', averageSpeedKmh: 45,
          seasonalVariation: '',
          directions: [],
        }
      }
    }
    // air=5, noise=5, climate=5, wind=1 → 4
    expect(computeEnvironmentScore(r)).toBeCloseTo(4, 1)
  })
})

// ── Climate score ─────────────────────────────────────────────────────────────

describe('computeClimateScore', () => {
  it('returns 5 when summer and winter strings are empty', () => {
    expect(computeClimateScore(baseReview)).toBe(5)
  })

  it('mild climate: summer max 28°C, winter min 8°C → both score 9, avg 9', () => {
    const r = { ...baseReview, climate: {
      summerAverages: 'Summers average 20–28°C.',
      winterAverages: 'Winters average 8–16°C.',
    } }
    expect(computeClimateScore(r)).toBe(9)
  })

  it('harsh summer: max 42°C → summer score 1', () => {
    const r = { ...baseReview, climate: {
      summerAverages: 'Summers are brutal, averaging 30–42°C.',
      winterAverages: 'Winters average 10–18°C.',
    } }
    // summer=1, winter=10 → 5.5
    expect(computeClimateScore(r)).toBeCloseTo(5.5, 1)
  })

  it('harsh winter: min -6°C → winter score 1', () => {
    const r = { ...baseReview, climate: {
      summerAverages: 'Summers average 20–25°C.',
      winterAverages: 'Winters are cold, averaging -6–5°C.',
    } }
    // summer=10, winter=1 → 5.5
    expect(computeClimateScore(r)).toBeCloseTo(5.5, 1)
  })

  it('extreme both ends: summer 43°C, winter -10°C → score 1', () => {
    const r = { ...baseReview, climate: {
      summerAverages: 'Max 43°C in summer.',
      winterAverages: 'Min -10°C in winter.',
    } }
    expect(computeClimateScore(r)).toBe(1)
  })
})

// ── computeScores overall ─────────────────────────────────────────────────────

describe('computeScores', () => {
  it('overall is average of 4 sub-scores rounded to 1dp', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '+5%', medianWeeklyRent: '$450', grossYield: '3.5%' },
    ] }
    const scores = computeScores(r)
    const expected = Math.round(((scores.property + scores.safety + scores.infrastructure + scores.environment) / 4) * 10) / 10
    expect(scores.overall).toBe(expected)
  })

  it('does not include a demographics field', () => {
    const scores = computeScores(baseReview)
    expect(Object.keys(scores)).not.toContain('demographics')
  })

  it('all scores are between 1 and 10', () => {
    const scores = computeScores(baseReview)
    for (const [key, val] of Object.entries(scores)) {
      expect(val, `${key} out of range`).toBeGreaterThanOrEqual(1)
      expect(val, `${key} out of range`).toBeLessThanOrEqual(10)
    }
  })
})

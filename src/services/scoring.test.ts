import { describe, it, expect } from 'vitest'
import {
  computePropertyScore,
  computeSafetyScore,
  computeInfrastructureScore,
  computeEnvironmentScore,
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

  it('scores 10 at 15% growth', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$800k', twelveMonthGrowth: '+15%', medianWeeklyRent: '$500', grossYield: '3%' },
    ] }
    expect(computePropertyScore(r)).toBe(10)
  })

  it('scores 1 at -5% growth', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$500k', twelveMonthGrowth: '-5%', medianWeeklyRent: '$400', grossYield: '4%' },
    ] }
    expect(computePropertyScore(r)).toBe(1)
  })

  it('clamps below 1 for growth below -5%', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$500k', twelveMonthGrowth: '-20%', medianWeeklyRent: '$400', grossYield: '4%' },
    ] }
    expect(computePropertyScore(r)).toBe(1)
  })

  it('clamps above 10 for growth above 15%', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$500k', twelveMonthGrowth: '+30%', medianWeeklyRent: '$400', grossYield: '4%' },
    ] }
    expect(computePropertyScore(r)).toBe(10)
  })

  it('averages both rows', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$800k', twelveMonthGrowth: '+15%', medianWeeklyRent: '$500', grossYield: '3%' },
      { propertyType: 'Units', medianPrice: '$500k', twelveMonthGrowth: '-5%', medianWeeklyRent: '$400', grossYield: '4%' },
    ] }
    // avg growth = 5% → 1 + (5+5)/20*9 = 1+4.5 = 5.5
    expect(computePropertyScore(r)).toBe(5.5)
  })

  it('scores ~5.5 at 5% average growth', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '+5%', medianWeeklyRent: '$450', grossYield: '3.5%' },
    ] }
    expect(computePropertyScore(r)).toBe(5.5)
  })

  it('handles growth without + sign', () => {
    const r = { ...baseReview, marketRows: [
      { propertyType: 'Houses', medianPrice: '$700k', twelveMonthGrowth: '5%', medianWeeklyRent: '$450', grossYield: '3.5%' },
    ] }
    expect(computePropertyScore(r)).toBe(5.5)
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
    // Theft=Low(10) weight 1, Assault=Very High(1) weight 2 → (10*1 + 1*2) / 3 = 4
    const r = { ...baseReview, crime: { ...baseReview.crime, crimeTypes: [
      { label: 'Theft', level: 'Low' as const },
      { label: 'Assault', level: 'Very High' as const },
    ] } }
    expect(computeSafetyScore(r)).toBeCloseTo(4, 1)
  })
})

// ── Infrastructure score ──────────────────────────────────────────────────────

describe('computeInfrastructureScore', () => {
  it('returns ~4.2 when all data missing (transit has no trains so (0+5)/2=2.5, services+amenity neutral=5)', () => {
    // transit: no trains(0) + bus missing(5) = 2.5; services: 5 (missing); amenity: 5 (missing)
    // avg = (2.5 + 5 + 5) / 3 = 4.2
    expect(computeInfrastructureScore(baseReview)).toBeCloseTo(4.2, 1)
  })

  it('boosts transit score with train stations', () => {
    const r = { ...baseReview, infrastructure: {
      ...baseReview.infrastructure,
      trainStations: [{ name: 'Central', lines: 'Metro' }, { name: 'North', lines: 'Metro' }],
      busAvailability: 'Excellent' as const,
    } }
    // transit: (7+10)/2 = 8.5, services: 5 (missing), amenity: 5 → avg = 6.2
    expect(computeInfrastructureScore(r)).toBeCloseTo(6.2, 1)
  })

  it('floors services bucket at 3 when counts are all 0', () => {
    const r = { ...baseReview, infrastructure: {
      ...baseReview.infrastructure,
      primarySchools: 0,
      secondarySchools: 0,
      medicalCentres: 0,
      shoppingPrecincts: 0,
    } }
    // transit: (0+5)/2=2.5, services: max(3,0)=3, amenity: 5 → avg ≈ 3.5
    expect(computeInfrastructureScore(r)).toBeCloseTo(3.5, 1)
  })

  it('scores well with good data', () => {
    const r = { ...baseReview, infrastructure: {
      ...baseReview.infrastructure,
      trainStations: [{ name: 'A', lines: 'X' }, { name: 'B', lines: 'Y' }, { name: 'C', lines: 'Z' }],
      busAvailability: 'Excellent' as const,
      primarySchools: 3,
      secondarySchools: 2,
      medicalCentres: 3,
      shoppingPrecincts: 3,
      parks: 6,
      pointsOfInterest: [1,2,3,4,5,6].map(i => ({ icon: '🏛', label: `POI ${i}` })),
    } }
    // transit: (10+10)/2=10, services: (10+10+10+10)/4=10, amenity: (10+10)/2=10 → 10
    expect(computeInfrastructureScore(r)).toBe(10)
  })
})

// ── Environment score ─────────────────────────────────────────────────────────

describe('computeEnvironmentScore', () => {
  it('returns 5 when no air quality or noise data', () => {
    expect(computeEnvironmentScore(baseReview)).toBe(5)
  })

  it('scores 10 when all Low (clean and quiet)', () => {
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
    expect(computeEnvironmentScore(r)).toBe(10)
  })

  it('scores 1 when all Very High', () => {
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
    expect(computeEnvironmentScore(r)).toBe(1)
  })

  it('returns 5 for air quality only when noise missing (50/50 split)', () => {
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
    // air=10, noise=5 (missing) → (10+5)/2 = 7.5
    expect(computeEnvironmentScore(r)).toBe(7.5)
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

import type { Review, ReviewScores } from '../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Parse a percentage string like "+4.2%", "-1.5%", "3%" → number */
const parsePercent = (s: string): number | null => {
  const m = s.replace(/\s/g, '').match(/([+-]?\d+(?:\.\d+)?)%/)
  return m ? parseFloat(m[1]) : null
}

const levelToScore: Record<string, number> = {
  Low: 10,
  Medium: 5,
  High: 2,
  'Very High': 1,
}

/** Low = best (air/noise), missing → neutral 5 */
const levelScore = (level: string | undefined) =>
  level != null ? (levelToScore[level] ?? 5) : 5

const round1 = (n: number) => Math.round(n * 10) / 10

// ── Property score ────────────────────────────────────────────────────────────
// Based on 12-month growth for Houses and Units (average of both).
// Linear scale: -5% → 1/10, 10% → 10/10
//
//   score = 1 + (growth - (-5)) / (10 - (-5)) * 9
//         = 1 + (growth + 5) / 15 * 9

export const computePropertyScore = (review: Review): number => {
  const growths = review.marketRows
    .map((r) => parsePercent(r.twelveMonthGrowth))
    .filter((v): v is number => v !== null)

  if (!growths.length) return 5  // neutral if no data

  const avg = growths.reduce((a, b) => a + b, 0) / growths.length
  const score = 1 + ((avg + 5) / 15) * 9
  return round1(clamp(score, 1, 10))
}

// ── Safety score ─────────────────────────────────────────────────────────────
// Based on crimeTypes levels. Assault and Break & Enter are weighted 2x.
// Low → 10, Medium → 5, High → 2, Very High → 1. Missing → 5.

const CRIME_WEIGHTS: Record<string, number> = {
  'Assault': 2,
  'Break & Enter': 2,
}
const DEFAULT_CRIME_WEIGHT = 1

export const computeSafetyScore = (review: Review): number => {
  const types = review.crime.crimeTypes
  if (!types?.length) return 5

  let weightedSum = 0
  let totalWeight = 0
  for (const { label, level } of types) {
    const w = CRIME_WEIGHTS[label] ?? DEFAULT_CRIME_WEIGHT
    weightedSum += levelScore(level) * w
    totalWeight += w
  }

  return round1(clamp(weightedSum / totalWeight, 1, 10))
}

// ── Infrastructure score ──────────────────────────────────────────────────────
// Three equal buckets, each scored 1–10, averaged.
//
// Transit bucket:
//   trainStations count:  0→0pts, 1→4pts, 2→7pts, 3+→10pts
//   busAvailability:      Excellent→10, Good→7, Limited→3, None→0, missing→5
//   bucket = (train + bus) / 2
//
// Services bucket:
//   primarySchools:    scale 0→0, 1→4, 2→7, 3+→10
//   secondarySchools:  scale 0→0, 1→6, 2+→10
//   medicalCentres:    scale 0→0, 1→5, 2→8, 3+→10
//   shoppingPrecincts: scale 0→0, 1→5, 2→8, 3+→10
//   bucket = avg of present fields, floor 3
//
// Amenity bucket:
//   parks:            scale 0→0, 1-2→4, 3-4→7, 5+→10
//   pointsOfInterest: scale 0→0, 1-2→4, 3-5→7, 6+→10
//   bucket = avg of present fields, floor 3

const steppedScore = (n: number, steps: [number, number][]): number => {
  // steps: [[threshold, score], ...] in ascending order
  let result = 0
  for (const [threshold, score] of steps) {
    if (n >= threshold) result = score
    else break
  }
  return result
}

const busScore = (bus: string | undefined): number => {
  if (!bus) return 5
  return { Excellent: 10, Good: 7, Limited: 3, None: 0 }[bus] ?? 5
}

export const computeInfrastructureScore = (review: Review): number => {
  const infra = review.infrastructure

  // Transit
  const trainCount = infra.trainStations?.length ?? 0
  const trainPts = steppedScore(trainCount, [[0, 0], [1, 4], [2, 7], [3, 10]])
  const busPts = busScore(infra.busAvailability)
  const transitScore = (trainPts + busPts) / 2

  // Services
  const serviceInputs: number[] = []
  if (infra.primarySchools != null)
    serviceInputs.push(steppedScore(infra.primarySchools, [[0, 0], [1, 4], [2, 7], [3, 10]]))
  if (infra.secondarySchools != null)
    serviceInputs.push(steppedScore(infra.secondarySchools, [[0, 0], [1, 6], [2, 10]]))
  if (infra.medicalCentres != null)
    serviceInputs.push(steppedScore(infra.medicalCentres, [[0, 0], [1, 5], [2, 8], [3, 10]]))
  if (infra.shoppingPrecincts != null)
    serviceInputs.push(steppedScore(infra.shoppingPrecincts, [[0, 0], [1, 5], [2, 8], [3, 10]]))
  const servicesScore = serviceInputs.length
    ? Math.max(3, serviceInputs.reduce((a, b) => a + b, 0) / serviceInputs.length)
    : 5

  // Amenity
  const amenityInputs: number[] = []
  if (infra.parks != null)
    amenityInputs.push(steppedScore(infra.parks, [[0, 0], [1, 4], [3, 7], [5, 10]]))
  if (infra.pointsOfInterest != null)
    amenityInputs.push(steppedScore(infra.pointsOfInterest.length, [[0, 0], [1, 4], [3, 7], [6, 10]]))
  const amenityScore = amenityInputs.length
    ? Math.max(3, amenityInputs.reduce((a, b) => a + b, 0) / amenityInputs.length)
    : 5

  const score = (transitScore + servicesScore + amenityScore) / 3
  return round1(clamp(score, 1, 10))
}

// ── Environment score ─────────────────────────────────────────────────────────
// 50% air quality + 50% noise.
// Within each group, equal weight across 4 sources. Missing → 5 (neutral/Medium).

export const computeEnvironmentScore = (review: Review): number => {
  const aq = review.climate.airQuality
  const noise = review.climate.noise

  const airScore = aq
    ? (levelScore(aq.particulateMatterLevel) +
       levelScore(aq.ozoneLevel) +
       levelScore(aq.pollenLevel) +
       levelScore(aq.industrialPollutionLevel)) / 4
    : 5

  const noiseScore = noise
    ? (levelScore(noise.flightPathLevel) +
       levelScore(noise.railNoiseLevel) +
       levelScore(noise.roadNoiseLevel) +
       levelScore(noise.industrialZonesLevel)) / 4
    : 5

  return round1(clamp((airScore + noiseScore) / 2, 1, 10))
}

// ── Overall ───────────────────────────────────────────────────────────────────
// Equal weight across the 4 computed scores.

export const computeScores = (review: Review): ReviewScores => {
  const property = computePropertyScore(review)
  const safety = computeSafetyScore(review)
  const infrastructure = computeInfrastructureScore(review)
  const environment = computeEnvironmentScore(review)
  const overall = round1((property + safety + infrastructure + environment) / 4)
  return { overall, property, safety, infrastructure, environment }
}

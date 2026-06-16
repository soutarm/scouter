import type { Review, ReviewScores } from '../types'
import { extractTemperatureProfile } from '../components/review/ThermometerRange'

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
// Relative to state median growth (stateMedianGrowth) when available.
//   - Suburb at state average → 5/10
//   - +7.5pp above average → 10/10
//   - -7.5pp below average → 1/10
//   score = 5 + (suburbGrowth - stateGrowth) / 7.5 * 4.5
//
// Falls back to absolute scale when stateMedianGrowth is missing:
//   -5% → 1/10, 10% → 10/10

export const computePropertyScore = (review: Review): number => {
  const growths = review.marketRows
    .map((r) => parsePercent(r.twelveMonthGrowth))
    .filter((v): v is number => v !== null)

  if (!growths.length) return 5

  const avg = growths.reduce((a, b) => a + b, 0) / growths.length

  const stateGrowth = review.stateMedianGrowth != null ? parsePercent(review.stateMedianGrowth) : null
  if (stateGrowth != null) {
    const score = 5 + ((avg - stateGrowth) / 7.5) * 4.5
    return round1(clamp(score, 1, 10))
  }

  // Fallback: absolute scale -5% → 1, 10% → 10
  const score = 1 + ((avg + 5) / 15) * 9
  return round1(clamp(score, 1, 10))
}

// ── Safety score ─────────────────────────────────────────────────────────────
// Based on crimeTypes levels.
// Weights: Assault 2x, Break & Enter 2x, Vehicle theft 1.5x, others 1x.
// Low → 10, Medium → 5, High → 2, Very High → 1. Missing → 5.

const CRIME_WEIGHTS: Record<string, number> = {
  'Assault': 2,
  'Break & Enter': 2,
  'Vehicle theft': 1.5,
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
// Three equal buckets (Transit, Services, Amenity), each scored 1–10, averaged.
//
// Thresholds scale by population tier so small suburbs aren't penalised for
// lacking metro-scale infrastructure.
//
// Population tiers (parsed from LLM string, e.g. "~12,000"):
//   Small:  < 8,000   — 1 train station = excellent
//   Medium: 8k–40k    — 2 train stations = excellent  (default when unknown)
//   Large:  > 40,000  — 3+ train stations = excellent
//
// Transit bucket:
//   trainStations: Small→[0,4,10], Medium→[0,4,7,10], Large→[0,2,5,10] (by count)
//   busAvailability: Excellent→10, Good→7, Limited→3, None→0, missing→5
//
// Services bucket (per tier):
//   Small  — 1 primary school = 10, 1 medical = 10, 1 shopping = 10
//   Medium — 2 primary = 10, 1 secondary = 7 / 2 = 10, 2 medical = 10
//   Large  — 3+ primary = 10, 2+ secondary = 10, 3+ medical = 10
//
// Amenity bucket (per tier):
//   Small  — 1 park = 10, 2 POIs = 10
//   Medium — 3 parks = 10, 4 POIs = 10
//   Large  — 5 parks = 10, 6 POIs = 10

type PopTier = 'small' | 'medium' | 'large'

/** Parse LLM population string → numeric estimate. Returns null if unparseable. */
const parsePopulation = (pop: string | undefined): number | null => {
  if (!pop) return null
  // Strip commas, spaces, tildes, "approx", "approximately", "~"
  const cleaned = pop.replace(/[~,\s]/g, '').replace(/approx(?:imately)?/i, '')
  // Match patterns like "12000", "12k", "1.2m"
  const m = cleaned.match(/(\d+(?:\.\d+)?)\s*([km]?)/i)
  if (!m) return null
  const n = parseFloat(m[1])
  const unit = m[2].toLowerCase()
  if (unit === 'k') return n * 1_000
  if (unit === 'm') return n * 1_000_000
  return n
}

const popTier = (pop: string | undefined): PopTier => {
  const n = parsePopulation(pop)
  if (n === null) return 'medium'
  if (n < 8_000) return 'small'
  if (n < 40_000) return 'medium'
  return 'large'
}

const steppedScore = (n: number, steps: [number, number][]): number => {
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

// Per-tier stepped tables
const TRAIN_STEPS: Record<PopTier, [number, number][]> = {
  small:  [[0, 0], [1, 10]],
  medium: [[0, 0], [1, 4], [2, 7], [3, 10]],
  large:  [[0, 0], [1, 2], [2, 5], [3, 8], [4, 10]],
}

const PRIMARY_STEPS: Record<PopTier, [number, number][]> = {
  small:  [[0, 0], [1, 10]],
  medium: [[0, 0], [1, 4], [2, 7], [3, 10]],
  large:  [[0, 0], [1, 2], [2, 5], [3, 8], [4, 10]],
}

const SECONDARY_STEPS: Record<PopTier, [number, number][]> = {
  small:  [[0, 0], [1, 10]],
  medium: [[0, 0], [1, 6], [2, 10]],
  large:  [[0, 0], [1, 4], [2, 7], [3, 10]],
}

const MEDICAL_STEPS: Record<PopTier, [number, number][]> = {
  small:  [[0, 0], [1, 10]],
  medium: [[0, 0], [1, 5], [2, 8], [3, 10]],
  large:  [[0, 0], [1, 3], [2, 6], [3, 9], [4, 10]],
}

const SHOPPING_STEPS: Record<PopTier, [number, number][]> = {
  small:  [[0, 0], [1, 10]],
  medium: [[0, 0], [1, 5], [2, 8], [3, 10]],
  large:  [[0, 0], [1, 3], [2, 6], [3, 9], [4, 10]],
}

const PARKS_STEPS: Record<PopTier, [number, number][]> = {
  small:  [[0, 0], [1, 7], [2, 10]],
  medium: [[0, 0], [1, 4], [3, 7], [5, 10]],
  large:  [[0, 0], [1, 2], [3, 5], [5, 7], [8, 10]],
}

const POI_STEPS: Record<PopTier, [number, number][]> = {
  small:  [[0, 0], [1, 7], [2, 10]],
  medium: [[0, 0], [1, 4], [3, 7], [6, 10]],
  large:  [[0, 0], [1, 2], [3, 5], [6, 8], [9, 10]],
}

export const computeInfrastructureScore = (review: Review): number => {
  const infra = review.infrastructure
  const tier = popTier(review.demographics?.population)

  // Transit
  const trainCount = infra.trainStations?.length ?? 0
  const trainPts = steppedScore(trainCount, TRAIN_STEPS[tier])
  const busPts = busScore(infra.busAvailability)
  const transitScore = (trainPts + busPts) / 2

  // Services
  const serviceInputs: number[] = []
  if (infra.primarySchools != null)
    serviceInputs.push(steppedScore(infra.primarySchools, PRIMARY_STEPS[tier]))
  if (infra.secondarySchools != null)
    serviceInputs.push(steppedScore(infra.secondarySchools, SECONDARY_STEPS[tier]))
  if (infra.medicalCentres != null)
    serviceInputs.push(steppedScore(infra.medicalCentres, MEDICAL_STEPS[tier]))
  if (infra.shoppingPrecincts != null)
    serviceInputs.push(steppedScore(infra.shoppingPrecincts, SHOPPING_STEPS[tier]))
  const servicesScore = serviceInputs.length
    ? Math.max(3, serviceInputs.reduce((a, b) => a + b, 0) / serviceInputs.length)
    : 5

  // Amenity
  const amenityInputs: number[] = []
  if (infra.parks != null)
    amenityInputs.push(steppedScore(infra.parks, PARKS_STEPS[tier]))
  if (infra.pointsOfInterest != null)
    amenityInputs.push(steppedScore(infra.pointsOfInterest.length, POI_STEPS[tier]))
  const amenityScore = amenityInputs.length
    ? Math.max(3, amenityInputs.reduce((a, b) => a + b, 0) / amenityInputs.length)
    : 5

  const score = (transitScore + servicesScore + amenityScore) / 3
  return round1(clamp(score, 1, 10))
}

// ── Environment score ─────────────────────────────────────────────────────────
// Equal quarters: air quality + noise + climate comfort + wind.
// Climate comfort: avg of summer-max score + winter-min score. Missing → 5.
// Wind: Low→10, Medium→7, High→3, Very High→1. Missing → 5.
//
// Summer max (°C):  ≤25→10, 28→9, 31→7, 34→5, 37→3, 40→2, ≥43→1
// Winter min (°C):  ≥10→10,  7→9,  4→7,  1→5, -2→3, -5→2, ≤-8→1

const summerMaxScore = (tempC: number): number => {
  if (tempC <= 25) return 10
  if (tempC <= 28) return 9
  if (tempC <= 31) return 7
  if (tempC <= 34) return 5
  if (tempC <= 37) return 3
  if (tempC <= 40) return 2
  return 1
}

const winterMinScore = (tempC: number): number => {
  if (tempC >= 10) return 10
  if (tempC >= 7)  return 9
  if (tempC >= 4)  return 7
  if (tempC >= 1)  return 5
  if (tempC >= -2) return 3
  if (tempC >= -5) return 2
  return 1
}

export const computeClimateScore = (review: Review): number => {
  const summerProfile = extractTemperatureProfile(review.climate.summerAverages)
  const winterProfile = extractTemperatureProfile(review.climate.winterAverages)

  const summerScore = summerProfile != null ? summerMaxScore(summerProfile.max) : 5
  const winterScore = winterProfile != null ? winterMinScore(winterProfile.min) : 5

  return round1(clamp((summerScore + winterScore) / 2, 1, 10))
}

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

  const climateScore = computeClimateScore(review)

  const windRating = review.climate.wind?.overallRating
  const windScoreMap: Record<string, number> = { Low: 10, Medium: 7, High: 3, 'Very High': 1 }
  const windScore = windRating != null ? (windScoreMap[windRating] ?? 5) : 5

  return round1(clamp((airScore + noiseScore + climateScore + windScore) / 4, 1, 10))
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

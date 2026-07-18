/**
 * ABS Census 2021 demographic data service.
 *
 * Fetches real Census 2021 data for a suburb from the ABS Data API (SDMX-JSON).
 * CORS is open (ABS reflects any Origin), so this is called directly from the
 * browser, same as Nominatim/Overpass in osm.ts.
 *
 * Suburbs are addressed via ABS "SAL" (Suburbs and Localities) codes. The SAL
 * codelist is fetched once and cached in localStorage indefinitely - the 2021
 * SAL boundaries are static until the next Census.
 */

import type { AustralianState, DemographicDatum } from '../types'

const ABS_API_BASE = 'https://data.api.abs.gov.au/rest'
const TIMEOUT_MS = 12_000
const SAL_CACHE_KEY = 'scouter.abs-sal-codes.v1'

const STATE_CODES: Record<AustralianState, string> = {
  NSW: '1', VIC: '2', QLD: '3', SA: '4', WA: '5', TAS: '6', NT: '7', ACT: '8',
}

// ---------------------------------------------------------------------------
// SAL (Suburbs and Localities) code lookup
// ---------------------------------------------------------------------------

type SalEntry = { code: string; stateCode: string }
type SalLookup = Record<string, SalEntry[]>

type SdmxCodelistResponse = {
  data?: {
    codelists?: Array<{
      codes?: Array<{ id: string; name: string; parent?: string }>
    }>
  }
}

let salLookupPromise: Promise<SalLookup | null> | null = null

async function fetchSalLookup(): Promise<SalLookup | null> {
  try {
    const cached = window.localStorage.getItem(SAL_CACHE_KEY)
    if (cached) return JSON.parse(cached) as SalLookup
  } catch {
    // corrupt/unavailable cache - fall through and refetch
  }

  try {
    const res = await fetch(`${ABS_API_BASE}/codelist/ABS/CL_SAL_2021/1.0.0`, {
      headers: { Accept: 'application/vnd.sdmx.structure+json' },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const payload = await res.json() as SdmxCodelistResponse
    const codes = payload.data?.codelists?.[0]?.codes ?? []

    const lookup: SalLookup = {}
    for (const c of codes) {
      // Real suburb/locality entries are parented directly by a state code (1-9).
      // This excludes the AUS root and the state-level rows themselves (parent "AUS").
      if (!c.parent || !/^[1-9]$/.test(c.parent)) continue
      const key = c.name.trim().toLowerCase()
      const entry: SalEntry = { code: c.id, stateCode: c.parent }
      if (!lookup[key]) lookup[key] = []
      lookup[key].push(entry)
    }

    try {
      window.localStorage.setItem(SAL_CACHE_KEY, JSON.stringify(lookup))
    } catch {
      // localStorage full/unavailable - lookup still works for this session
    }
    return lookup
  } catch {
    return null
  }
}

async function resolveSalCode(suburb: string, state: AustralianState): Promise<SalEntry | null> {
  if (!salLookupPromise) salLookupPromise = fetchSalLookup()
  const lookup = await salLookupPromise
  if (!lookup) return null
  const entries = lookup[suburb.trim().toLowerCase()]
  if (!entries?.length) return null
  const stateCode = STATE_CODES[state]
  return entries.find((e) => e.stateCode === stateCode) ?? null
}

// ---------------------------------------------------------------------------
// Generic Census 2021 SAL table fetch/decode
// ---------------------------------------------------------------------------

type CensusRow = { codes: Record<string, string>; value: number }

type SdmxDataResponse = {
  data?: {
    structures?: Array<{
      dimensions?: { series?: Array<{ id: string; values: Array<{ id: string }> }> }
    }>
    dataSets?: Array<{
      series?: Record<string, { observations?: Record<string, number[]> }>
    }>
  }
}

// dimensionKey uses "." separated positional segments; blank segment = wildcard (all values).
async function fetchCensusRows(tableId: string, dimensionKey: string): Promise<CensusRow[] | null> {
  try {
    const url = `${ABS_API_BASE}/data/ABS,${tableId},1.0.0/${dimensionKey}`
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.sdmx.data+json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const payload = await res.json() as SdmxDataResponse
    const seriesDims = payload.data?.structures?.[0]?.dimensions?.series
    const dataSet = payload.data?.dataSets?.[0]
    if (!seriesDims?.length || !dataSet?.series) return null

    const rows: CensusRow[] = []
    for (const [key, series] of Object.entries(dataSet.series)) {
      const indices = key.split(':').map(Number)
      const codes: Record<string, string> = {}
      seriesDims.forEach((dim, i) => {
        codes[dim.id] = dim.values[indices[i]]?.id ?? ''
      })
      const value = series.observations?.['0']?.[0]
      if (typeof value === 'number') rows.push({ codes, value })
    }
    return rows
  } catch {
    return null
  }
}

const valueFor = (rows: CensusRow[], match: Record<string, string>): number => {
  const row = rows.find((r) => Object.entries(match).every(([k, v]) => r.codes[k] === v))
  return row?.value ?? 0
}

const toBuckets = (pairs: Array<[string, number]>): DemographicDatum[] =>
  pairs.filter(([, value]) => value > 0).map(([label, value]) => ({ label, value }))

// ---------------------------------------------------------------------------
// Per-category fetch + bucketing
// ---------------------------------------------------------------------------

const AGE_BUCKETS: Array<[string, string[]]> = [
  ['0-14', ['0_4', '5_9', '10_14']],
  ['15-24', ['15_19', '20_24']],
  ['25-44', ['25_29', '30_34', '35_39', '40_44']],
  ['45-64', ['45_49', '50_54', '55_59', '60_64']],
  ['65+', ['65_69', '70_74', '75_79', '80_84', '85_89', '90_94', '95_99', 'GE100']],
]

async function fetchAgeGroups(region: string, state: string): Promise<DemographicDatum[] | null> {
  const rows = await fetchCensusRows('C21_G04_SAL', `.3.${region}.SAL.${state}`)
  if (!rows) return null
  return toBuckets(
    AGE_BUCKETS.map(([label, codes]) => [
      label,
      codes.reduce((sum, code) => sum + valueFor(rows, { AGEINGP: code }), 0),
    ]),
  )
}

async function fetchHouseholdTypes(region: string, state: string): Promise<DemographicDatum[] | null> {
  const rows = await fetchCensusRows('C21_G35_SAL', `..${region}.SAL.${state}`)
  if (!rows) return null
  const family = valueFor(rows, { HHCD: '1_2', NPRD: '_T' })
  const singlePerson = valueFor(rows, { HHCD: '3', NPRD: '1' })
  const nonFamilyTotal = valueFor(rows, { HHCD: '3', NPRD: '_T' })
  const group = Math.max(0, nonFamilyTotal - singlePerson)
  return toBuckets([
    ['Family households', family],
    ['Single-person households', singlePerson],
    ['Group households', group],
  ])
}

async function fetchTenureTypes(region: string, state: string): Promise<DemographicDatum[] | null> {
  const rows = await fetchCensusRows('C21_G37_SAL', `._T.${region}.SAL.${state}`)
  if (!rows) return null
  return toBuckets([
    ['Owned outright', valueFor(rows, { TENLLD: '1' })],
    ['Mortgage', valueFor(rows, { TENLLD: '2' })],
    ['Rented', valueFor(rows, { TENLLD: 'R_T' })],
  ])
}

// Country of birth codes at SAL geography (ABS SACC broad classification, fixed set).
const COUNTRY_LABELS: Record<string, string> = {
  '7201': 'Afghanistan', '11': 'Australia', '7101': 'Bangladesh', '3202': 'Bosnia and Herzegovina',
  '8203': 'Brazil', '5102': 'Cambodia', '8102': 'Canada', '8204': 'Chile',
  '6101': 'China', '3204': 'Croatia', '4102': 'Egypt', '2102': 'England',
  '1502': 'Fiji', '2303': 'France', '2304': 'Germany', '3207': 'Greece',
  '6102': 'Hong Kong', '7103': 'India', '5202': 'Indonesia', '4203': 'Iran',
  '4204': 'Iraq', '2201': 'Ireland', '3104': 'Italy', '6201': 'Japan',
  '6203': 'South Korea', '4208': 'Lebanon', '5203': 'Malaysia', '3105': 'Malta',
  '9214': 'Mauritius', '5101': 'Myanmar', '7105': 'Nepal', '2308': 'Netherlands',
  '1201': 'New Zealand', '3206': 'North Macedonia', '7106': 'Pakistan', '1302': 'Papua New Guinea',
  '5204': 'Philippines', '3307': 'Poland', '1505': 'Samoa', '2105': 'Scotland',
  '5205': 'Singapore', '9225': 'South Africa', '7107': 'Sri Lanka', '6105': 'Taiwan',
  '5104': 'Thailand', '4215': 'Turkey', '8104': 'United States of America', '5105': 'Vietnam',
  '2106': 'Wales', '9232': 'Zimbabwe', '_O': 'Born elsewhere',
}

async function fetchCountryOfOrigin(region: string, state: string): Promise<DemographicDatum[] | null> {
  const rows = await fetchCensusRows('C21_G09_SAL', `3.._T.${region}.SAL.${state}`)
  if (!rows) return null
  const labelled: Array<[string, number]> = rows
    .filter((r) => r.codes.BPLP && COUNTRY_LABELS[r.codes.BPLP])
    .map((r) => [COUNTRY_LABELS[r.codes.BPLP], r.value])
  return toBuckets(labelled.sort((a, b) => b[1] - a[1]).slice(0, 8))
}

const FAMILY_COMPOSITION_LABELS: Record<string, string> = {
  '1': 'Couple family, no children',
  '2': 'Couple family with children',
  '3': 'One parent family',
  '9': 'Other family',
}

async function fetchFamilyComposition(region: string, state: string): Promise<DemographicDatum[] | null> {
  const rows = await fetchCensusRows('C21_G29_SAL', `.F.${region}.SAL.${state}`)
  if (!rows) return null
  return toBuckets(
    Object.entries(FAMILY_COMPOSITION_LABELS).map(([code, label]) => [label, valueFor(rows, { FMCF: code })]),
  )
}

const RELIGION_LABELS: Record<string, string> = {
  '1': 'Buddhism',
  '2': 'Christianity',
  '3': 'Hinduism',
  '4': 'Islam',
  '5': 'Judaism',
  '6_T': 'Other religions',
  '7_T': 'No religion',
}

async function fetchReligion(region: string, state: string): Promise<DemographicDatum[] | null> {
  const rows = await fetchCensusRows('C21_G14_SAL', `.3.${region}.SAL.${state}`)
  if (!rows) return null
  const pairs = Object.entries(RELIGION_LABELS).map(([code, label]): [string, number] => [label, valueFor(rows, { RELP: code })])
  return toBuckets(pairs.sort((a, b) => b[1] - a[1]))
}

const INCOME_BUCKETS: Array<[string, string[]]> = [
  ['Under $650/wk', ['1', '2', '3', '4', '5', '6']],
  ['$650-$1,499/wk', ['7', '8', '9', '10']],
  ['$1,500-$2,999/wk', ['11', '12', '13', '14']],
  ['$3,000+/wk', ['15', '16', '17']],
]

async function fetchHouseholdIncome(region: string, state: string): Promise<DemographicDatum[] | null> {
  const rows = await fetchCensusRows('C21_G33_SAL', `._T.${region}.SAL.${state}`)
  if (!rows) return null
  return toBuckets(
    INCOME_BUCKETS.map(([label, codes]) => [
      label,
      codes.reduce((sum, code) => sum + valueFor(rows, { HIND: code }), 0),
    ]),
  )
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export type AbsDemographicsResult = {
  ageGroups?: DemographicDatum[]
  householdTypes?: DemographicDatum[]
  tenureTypes?: DemographicDatum[]
  countryOfOrigin?: DemographicDatum[]
  residentProfiles?: DemographicDatum[]
  religion?: DemographicDatum[]
  householdIncome?: DemographicDatum[]
  /** True if at least one category came back with data. */
  hasData: boolean
}

export async function fetchAbsDemographics(suburb: string, state: AustralianState): Promise<AbsDemographicsResult | null> {
  const sal = await resolveSalCode(suburb, state)
  if (!sal) return null

  const { code: region, stateCode } = sal
  const [ageGroups, householdTypes, tenureTypes, countryOfOrigin, residentProfiles, religion, householdIncome] =
    await Promise.all([
      fetchAgeGroups(region, stateCode),
      fetchHouseholdTypes(region, stateCode),
      fetchTenureTypes(region, stateCode),
      fetchCountryOfOrigin(region, stateCode),
      fetchFamilyComposition(region, stateCode),
      fetchReligion(region, stateCode),
      fetchHouseholdIncome(region, stateCode),
    ])

  const result: AbsDemographicsResult = {
    ageGroups: ageGroups ?? undefined,
    householdTypes: householdTypes ?? undefined,
    tenureTypes: tenureTypes ?? undefined,
    countryOfOrigin: countryOfOrigin ?? undefined,
    residentProfiles: residentProfiles ?? undefined,
    religion: religion ?? undefined,
    householdIncome: householdIncome ?? undefined,
    hasData: Boolean(
      ageGroups?.length || householdTypes?.length || tenureTypes?.length ||
      countryOfOrigin?.length || residentProfiles?.length || religion?.length || householdIncome?.length,
    ),
  }
  return result.hasData ? result : null
}

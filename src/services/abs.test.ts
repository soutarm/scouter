import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { fetchAbsDemographics as FetchAbsDemographicsType } from './abs'

type SeriesDim = { id: string; values: Array<{ id: string }> }

const dataResponse = (seriesDims: SeriesDim[], series: Record<string, number>) => ({
  data: {
    structures: [{ dimensions: { series: seriesDims } }],
    dataSets: [{
      series: Object.fromEntries(
        Object.entries(series).map(([key, value]) => [key, { observations: { '0': [value] } }]),
      ),
    }],
  },
})

const SAL_CODELIST_RESPONSE = {
  data: {
    codelists: [{
      codes: [
        { id: 'AUS', name: 'Australia' },
        { id: '2', name: 'Victoria', parent: 'AUS' },
        { id: '1', name: 'New South Wales', parent: 'AUS' },
        { id: '22547', name: 'Toorak', parent: '2' },
        { id: '10001', name: 'Riverside', parent: '1' },
        { id: '20002', name: 'Riverside', parent: '2' },
      ],
    }],
  },
}

// Region "22547" (Toorak, VIC / state code 2) fixtures for each Census table.
const AGE_RESPONSE = dataResponse(
  [
    { id: 'AGEINGP', values: [{ id: '0_4' }, { id: '15_19' }] },
    { id: 'SEXP', values: [{ id: '3' }] },
    { id: 'REGION', values: [{ id: '22547' }] },
    { id: 'REGION_TYPE', values: [{ id: 'SAL' }] },
    { id: 'STATE', values: [{ id: '2' }] },
  ],
  { '0:0:0:0:0': 40, '1:0:0:0:0': 60 },
)

const HOUSEHOLD_RESPONSE = dataResponse(
  [
    { id: 'NPRD', values: [{ id: '_T' }, { id: '1' }] },
    { id: 'HHCD', values: [{ id: '1_2' }, { id: '3' }] },
    { id: 'REGION', values: [{ id: '22547' }] },
    { id: 'REGION_TYPE', values: [{ id: 'SAL' }] },
    { id: 'STATE', values: [{ id: '2' }] },
  ],
  { '0:0:0:0:0': 100, '1:1:0:0:0': 30, '0:1:0:0:0': 50 },
)

const TENURE_RESPONSE = dataResponse(
  [
    { id: 'TENLLD', values: [{ id: '1' }, { id: '2' }, { id: 'R_T' }] },
    { id: 'STRD', values: [{ id: '_T' }] },
    { id: 'REGION', values: [{ id: '22547' }] },
    { id: 'REGION_TYPE', values: [{ id: 'SAL' }] },
    { id: 'STATE', values: [{ id: '2' }] },
  ],
  { '0:0:0:0:0': 200, '1:0:0:0:0': 300, '2:0:0:0:0': 150 },
)

const COUNTRY_RESPONSE = dataResponse(
  [
    { id: 'SEXP', values: [{ id: '3' }] },
    { id: 'BPLP', values: [{ id: '11' }, { id: '2102' }, { id: '_N' }] },
    { id: 'AGEP', values: [{ id: '_T' }] },
    { id: 'REGION', values: [{ id: '22547' }] },
    { id: 'REGION_TYPE', values: [{ id: 'SAL' }] },
    { id: 'STATE', values: [{ id: '2' }] },
  ],
  { '0:0:0:0:0:0': 500, '0:1:0:0:0:0': 80, '0:2:0:0:0:0': 5 },
)

const FAMILY_COMP_RESPONSE = dataResponse(
  [
    { id: 'FMCF', values: [{ id: '1' }, { id: '3' }] },
    { id: 'SUM', values: [{ id: 'F' }] },
    { id: 'REGION', values: [{ id: '22547' }] },
    { id: 'REGION_TYPE', values: [{ id: 'SAL' }] },
    { id: 'STATE', values: [{ id: '2' }] },
  ],
  { '0:0:0:0:0': 70, '1:0:0:0:0': 20 },
)

const RELIGION_RESPONSE = dataResponse(
  [
    { id: 'RELP', values: [{ id: '2' }, { id: '7_T' }] },
    { id: 'SEXP', values: [{ id: '3' }] },
    { id: 'REGION', values: [{ id: '22547' }] },
    { id: 'REGION_TYPE', values: [{ id: 'SAL' }] },
    { id: 'STATE', values: [{ id: '2' }] },
  ],
  { '0:0:0:0:0': 120, '1:0:0:0:0': 250 },
)

const INCOME_RESPONSE = dataResponse(
  [
    { id: 'HIND', values: [{ id: '2' }, { id: '9' }] },
    { id: 'HHCD', values: [{ id: '_T' }] },
    { id: 'REGION', values: [{ id: '22547' }] },
    { id: 'REGION_TYPE', values: [{ id: 'SAL' }] },
    { id: 'STATE', values: [{ id: '2' }] },
  ],
  { '0:0:0:0:0': 15, '1:0:0:0:0': 90 },
)

const okJson = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
const notOk = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)

const makeMockFetch = () => vi.fn((url: string) => {
  if (url.includes('codelist/ABS/CL_SAL_2021')) return okJson(SAL_CODELIST_RESPONSE)
  if (url.includes('C21_G04_SAL')) return okJson(AGE_RESPONSE)
  if (url.includes('C21_G35_SAL')) return okJson(HOUSEHOLD_RESPONSE)
  if (url.includes('C21_G37_SAL')) return okJson(TENURE_RESPONSE)
  if (url.includes('C21_G09_SAL')) return okJson(COUNTRY_RESPONSE)
  if (url.includes('C21_G29_SAL')) return okJson(FAMILY_COMP_RESPONSE)
  if (url.includes('C21_G14_SAL')) return okJson(RELIGION_RESPONSE)
  if (url.includes('C21_G33_SAL')) return okJson(INCOME_RESPONSE)
  return notOk()
})

let fetchAbsDemographics: typeof FetchAbsDemographicsType
let mockFetch: ReturnType<typeof makeMockFetch>

// abs.ts caches the SAL lookup in a module-scoped promise, so each test needs a
// fresh module instance (and cleared localStorage) to genuinely re-resolve it.
beforeEach(async () => {
  window.localStorage.clear()
  vi.resetModules()
  mockFetch = makeMockFetch()
  vi.stubGlobal('fetch', mockFetch)
  ;({ fetchAbsDemographics } = await import('./abs'))
})

describe('fetchAbsDemographics', () => {
  it('decodes and buckets all 7 categories for a resolved suburb', async () => {
    const result = await fetchAbsDemographics('Toorak', 'VIC')
    expect(result).not.toBeNull()

    expect(result?.ageGroups).toEqual(expect.arrayContaining([
      { label: '0-14', value: 40 },
      { label: '15-24', value: 60 },
    ]))

    expect(result?.householdTypes).toEqual(expect.arrayContaining([
      { label: 'Family households', value: 100 },
      { label: 'Single-person households', value: 30 },
      { label: 'Group households', value: 20 }, // 50 non-family total - 30 single-person
    ]))

    expect(result?.tenureTypes).toEqual([
      { label: 'Owned outright', value: 200 },
      { label: 'Mortgage', value: 300 },
      { label: 'Rented', value: 150 },
    ])

    expect(result?.countryOfOrigin).toEqual([
      { label: 'Australia', value: 500 },
      { label: 'England', value: 80 },
    ])

    expect(result?.residentProfiles).toEqual([
      { label: 'Couple family, no children', value: 70 },
      { label: 'One parent family', value: 20 },
    ])

    // Sorted descending by value, not by declaration order (No religion=250 outranks Christianity=120).
    expect(result?.religion).toEqual([
      { label: 'No religion', value: 250 },
      { label: 'Christianity', value: 120 },
    ])

    expect(result?.householdIncome).toEqual([
      { label: 'Under $650/wk', value: 15 },
      { label: '$650-$1,499/wk', value: 90 },
    ])
  })

  it('disambiguates suburbs with the same name in different states by SAL parent code', async () => {
    // "Riverside" exists as both 10001 (NSW, parent "1") and 20002 (VIC, parent "2").
    await fetchAbsDemographics('Riverside', 'NSW')
    const requestedUrls = mockFetch.mock.calls.map((call) => call[0] as string)
    const tableUrls = requestedUrls.filter((url) => url.includes('/data/ABS,'))
    expect(tableUrls.length).toBeGreaterThan(0)
    expect(tableUrls.every((url) => url.includes('10001'))).toBe(true)
    expect(tableUrls.some((url) => url.includes('20002'))).toBe(false)
  })

  it('returns null when the suburb cannot be resolved to a SAL code', async () => {
    const result = await fetchAbsDemographics('Nonexistent Place', 'VIC')
    expect(result).toBeNull()
    // Should not have attempted any Census table fetch without a resolved region.
    const tableUrls = mockFetch.mock.calls.map((call) => call[0] as string).filter((url) => url.includes('/data/ABS,'))
    expect(tableUrls.length).toBe(0)
  })

  it('returns null when the SAL codelist fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn(notOk))
    const result = await fetchAbsDemographics('Toorak', 'VIC')
    expect(result).toBeNull()
  })
})

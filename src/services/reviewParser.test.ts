import { describe, it, expect } from 'vitest'
import { stripJsonFence, stripTrailingCommas, repairTruncatedJson, parseReferenceLink, parseReview } from './reviewParser'

// ── stripJsonFence ────────────────────────────────────────────────────────────

describe('stripJsonFence', () => {
  it('returns plain JSON unchanged', () => {
    const json = '{"a":1}'
    expect(stripJsonFence(json)).toBe(json)
  })

  it('strips ```json fence', () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('strips ``` fence without language', () => {
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('extracts JSON from surrounding prose', () => {
    expect(stripJsonFence('Here is the JSON: {"a":1} done.')).toBe('{"a":1}')
  })

  it('handles whitespace padding', () => {
    expect(stripJsonFence('  {"a":1}  ')).toBe('{"a":1}')
  })
})

// ── stripTrailingCommas ───────────────────────────────────────────────────────

describe('stripTrailingCommas', () => {
  it('returns valid JSON unchanged', () => {
    const json = '{"a":1,"b":[1,2]}'
    expect(stripTrailingCommas(json)).toBe(json)
  })

  it('strips a trailing comma before a closing brace mid-document', () => {
    const input = '{"a":1,"nested":{"b":2,},"c":3}'
    const result = stripTrailingCommas(input)
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toEqual({ a: 1, nested: { b: 2 }, c: 3 })
  })

  it('strips a trailing comma before a closing bracket', () => {
    const result = stripTrailingCommas('{"a":[1,2,3,]}')
    expect(JSON.parse(result)).toEqual({ a: [1, 2, 3] })
  })

  it('ignores commas inside string values', () => {
    const input = '{"a":"one, two, three,"}'
    expect(stripTrailingCommas(input)).toBe(input)
  })

  it('handles a trailing comma across whitespace/newlines', () => {
    const input = '{\n  "a": 1,\n  "b": 2,\n}'
    const result = stripTrailingCommas(input)
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 })
  })
})

// ── repairTruncatedJson ───────────────────────────────────────────────────────

describe('repairTruncatedJson', () => {
  it('returns valid JSON unchanged', () => {
    const json = '{"a":1,"b":[1,2]}'
    expect(repairTruncatedJson(json)).toBe(json)
  })

  it('closes a truncated object', () => {
    const result = repairTruncatedJson('{"a":1,"b":2')
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 })
  })

  it('closes a truncated nested object', () => {
    const result = repairTruncatedJson('{"a":{"b":1')
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('closes a truncated array inside object', () => {
    const result = repairTruncatedJson('{"a":[1,2,3')
    expect(() => JSON.parse(result)).not.toThrow()
    expect(JSON.parse(result)).toMatchObject({ a: [1, 2, 3] })
  })

  it('strips trailing comma before closing', () => {
    const result = repairTruncatedJson('{"a":1,"b":2,')
    expect(() => JSON.parse(result)).not.toThrow()
  })

  it('handles truncation mid-string by trimming back to last safe outside-string position', () => {
    // Truncated inside a string: trims back to the colon after "summary",
    // strips the trailing colon via comma-strip, and closes. Result may omit the key.
    // The important thing is the output is valid JSON (an object).
    const result = repairTruncatedJson('{"a":1,"summary":"This suburb is great but the traf')
    expect(() => JSON.parse(result)).not.toThrow()
    expect(typeof JSON.parse(result)).toBe('object')
  })

  it('handles deeply nested truncation', () => {
    const result = repairTruncatedJson('{"a":{"b":{"c":[1,{"d":2')
    expect(() => JSON.parse(result)).not.toThrow()
  })
})

// ── parseReview ───────────────────────────────────────────────────────────────

describe('parseReview', () => {
  const validReviewWithMidDocumentTrailingComma = `{
  "exists": true,
  "suburb": "Croydon Hills",
  "state": "VIC",
  "generatedAt": "2024-07-30T12:00:00Z",
  "summary": "A leafy suburb.",
  "marketNarrative": "Steady growth.",
  "marketRows": [
    { "propertyType": "Houses", "medianPrice": "$900k", "twelveMonthGrowth": "+3%", "medianWeeklyRent": "$550", "grossYield": "3.2%" },
  ],
  "climate": { "summerAverages": "25-30C", "winterAverages": "8-14C" },
  "crime": { "narrative": "Low crime.", "insuranceImpact": "Standard." },
  "infrastructure": { "transit": "Good.", "education": "Good.", "lifestyle": "Good.", "demographic": "Mixed." },
  "caveats": []
}`

  it('recovers from a mid-document trailing comma (the LLM JSON bug)', () => {
    const result = parseReview(validReviewWithMidDocumentTrailingComma)
    expect(result.suburb).toBe('Croydon Hills')
    expect(result.marketRows).toHaveLength(1)
  })

  it('still throws a descriptive error for genuinely unparseable content', () => {
    expect(() => parseReview('{{{{')).toThrow(/invalid JSON/)
  })

  it('reports missing fields (not a parse error) when jsonrepair coerces bare text into a valid JSON string', () => {
    // jsonrepair is lenient enough to wrap unquoted text as a JSON string literal,
    // so this now fails the shape check rather than JSON.parse itself - still a
    // clear, correct error, just a different message than a raw parse failure.
    expect(() => parseReview('not json at all')).toThrow(/missing required fields/)
  })

  // Reproduces a real bug report: the model wrote an unescaped quote inside a long
  // "summary" string (e.g. a quoted place name), producing "Expected ',' or '}'
  // after property value" deep inside the field - not fixable by comma/truncation
  // repairs, but recoverable via the jsonrepair fallback pass.
  const reviewWithUnescapedQuoteInSummary = `{
  "exists": true,
  "suburb": "Croydon Hills",
  "state": "VIC",
  "generatedAt": "2024-07-30T12:00:00Z",
  "summary": "Croydon Hills is a leafy suburb near the "Yarra" valley, prized for its 12" hilltop views.",
  "marketNarrative": "Steady growth.",
  "marketRows": [
    { "propertyType": "Houses", "medianPrice": "$900k", "twelveMonthGrowth": "+3%", "medianWeeklyRent": "$550", "grossYield": "3.2%" }
  ],
  "climate": { "summerAverages": "25-30C", "winterAverages": "8-14C" },
  "crime": { "narrative": "Low crime.", "insuranceImpact": "Standard." },
  "infrastructure": { "transit": "Good.", "education": "Good.", "lifestyle": "Good.", "demographic": "Mixed." },
  "caveats": []
}`

  it('recovers from an unescaped quote inside a string value (the LLM JSON bug)', () => {
    const result = parseReview(reviewWithUnescapedQuoteInSummary)
    expect(result.suburb).toBe('Croydon Hills')
    expect(result.summary).toContain('Yarra')
  })
})

// ── parseReferenceLink ────────────────────────────────────────────────────────

describe('parseReferenceLink', () => {
  it('parses markdown link', () => {
    const result = parseReferenceLink('[ABS Census](https://abs.gov.au/census)')
    expect(result).toEqual({ label: 'ABS Census', url: 'https://abs.gov.au/census' })
  })

  it('extracts bare URL', () => {
    const result = parseReferenceLink('See https://abs.gov.au for data')
    expect(result.url).toBe('https://abs.gov.au')
  })

  it('strips trailing punctuation from URL', () => {
    const result = parseReferenceLink('https://abs.gov.au.')
    expect(result.url).toBe('https://abs.gov.au')
  })

  it('uses URL as label when no text', () => {
    const result = parseReferenceLink('https://abs.gov.au')
    expect(result.label).toBe('https://abs.gov.au')
    expect(result.url).toBe('https://abs.gov.au')
  })

  it('returns plain text with empty url when no URL present', () => {
    const result = parseReferenceLink('ABS Census data, 2021')
    expect(result.label).toBe('ABS Census data, 2021')
    expect(result.url).toBe('')
  })
})

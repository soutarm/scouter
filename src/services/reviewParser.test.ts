import { describe, it, expect } from 'vitest'
import { stripJsonFence, repairTruncatedJson, parseReferenceLink } from './reviewParser'

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

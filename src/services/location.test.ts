import { describe, it, expect } from 'vitest'
import { parseSearchParams } from './location'

describe('parseSearchParams', () => {
  it('returns null when no search param', () => {
    expect(parseSearchParams('')).toBeNull()
    expect(parseSearchParams('?state=VIC')).toBeNull()
  })

  it('reads place and state', () => {
    const result = parseSearchParams('?search=Richmond&state=VIC')
    expect(result?.place).toBe('Richmond')
    expect(result?.state).toBe('VIC')
  })

  it('reads tab param', () => {
    const result = parseSearchParams('?search=Richmond&state=VIC&tab=crime')
    expect(result?.tab).toBe('crime')
  })

  it('returns undefined tab when not present', () => {
    const result = parseSearchParams('?search=Richmond&state=VIC')
    expect(result?.tab).toBeUndefined()
  })

  it('uppercases a valid lowercase state', () => {
    const result = parseSearchParams('?search=Richmond&state=vic')
    expect(result?.state).toBe('VIC')
  })

  it('ignores invalid state, falls back to parsed or undefined', () => {
    const result = parseSearchParams('?search=Richmond&state=XYZ')
    // XYZ is not a valid state so it falls through to parsed.state from the place string
    expect(result?.state).not.toBe('XYZ')
  })

  it('parses suburb and state from search string when no state param', () => {
    const result = parseSearchParams('?search=Richmond%2C+VIC')
    expect(result?.place).toBeTruthy()
  })

  it('trims whitespace from search', () => {
    const result = parseSearchParams('?search=+Richmond+')
    expect(result?.place).toBe('Richmond')
  })
})

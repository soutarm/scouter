import { jsonrepair } from 'jsonrepair'
import type { Review, StateBenchmarks } from '../types'
import { computeScores, FALLBACK_BENCHMARKS, STATE_CAPITAL_CITIES } from './scoring'

export const stripJsonFence = (value: string): string => {
  const trimmed = value.trim()
  const fenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    return fenced.slice(start, end + 1)
  }
  return fenced
}

// Strips trailing commas before a closing } or ] anywhere in the document - the
// most common way LLMs produce syntactically invalid (but otherwise complete) JSON.
export const stripTrailingCommas = (s: string): string => {
  let result = ''
  let inString = false
  let escape = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) { result += ch; escape = false; continue }
    if (ch === '\\' && inString) { result += ch; escape = true; continue }
    if (ch === '"') { inString = !inString; result += ch; continue }
    if (!inString && ch === ',') {
      // Look ahead past whitespace to see if the next real character closes a container
      let j = i + 1
      while (j < s.length && /\s/.test(s[j])) j++
      if (s[j] === '}' || s[j] === ']') continue // drop this comma
    }
    result += ch
  }
  return result
}

export const repairTruncatedJson = (s: string): string => {
  // Walk the string tracking open brackets and whether we're inside a string,
  // so we know exactly what needs closing and where the last "safe" character was.
  const stack: string[] = []
  let inString = false
  let escape = false
  let lastSafeOutsideString = 0  // index of last char that was outside a string

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (escape) { escape = false; continue }
    if (ch === '\\' && inString) { escape = true; continue }
    if (ch === '"') {
      inString = !inString
      if (!inString) lastSafeOutsideString = i  // just closed a string
      continue
    }
    if (inString) continue
    lastSafeOutsideString = i
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']')
    else if ((ch === '}' || ch === ']') && stack.length) stack.pop()
  }

  // Already valid
  if (stack.length === 0 && !inString) return s

  // Trim back to the last character that was safely outside a string,
  // then strip any trailing comma, colon, or dangling "key": fragment before closing.
  let trimmed = s.slice(0, lastSafeOutsideString + 1).trimEnd()
  // Remove trailing comma
  trimmed = trimmed.replace(/,\s*$/, '')
  // Remove dangling "key": (a string followed by a colon with no value yet)
  trimmed = trimmed.replace(/,?\s*"[^"]*"\s*:\s*$/, '')
  // Remove trailing comma again in case stripping the key exposed one
  trimmed = trimmed.replace(/,\s*$/, '')

  return trimmed + stack.reverse().join('')
}

export const parseReview = (content: string, liveBenchmarks?: StateBenchmarks): Review => {
  const stripped = stripJsonFence(content)
  // Each attempt is a thunk (not a precomputed string) so a repair step that itself
  // throws (jsonrepair does, when it can't make sense of the input) is just skipped.
  const attempts: Array<() => string> = [
    () => stripped,
    () => stripTrailingCommas(stripped),
    () => repairTruncatedJson(stripped),
    () => stripTrailingCommas(repairTruncatedJson(stripped)),
    // Last resort: a full tolerant-JSON repair pass. Handles cases the targeted fixes
    // above don't, e.g. an unescaped quote inside a string value (a common LLM mistake
    // that produces "Expected ',' or '}'" parse errors deep inside a text field).
    () => jsonrepair(stripped),
  ]
  let parsed: Review | undefined
  let firstError: unknown
  for (const attempt of attempts) {
    try {
      parsed = JSON.parse(attempt()) as Review
      break
    } catch (e) {
      if (firstError === undefined) firstError = e
    }
  }
  if (!parsed) {
    const snippet = stripped.slice(0, 300).replace(/\n/g, ' ')
    throw new Error(`The model returned invalid JSON. Parse error: ${firstError instanceof Error ? firstError.message : firstError}. Content preview: ${snippet}`)
  }
  // Handle legacy string crime field from cached/old responses
  if (typeof parsed.crime === 'string') {
    parsed.crime = { narrative: parsed.crime as unknown as string, insuranceImpact: '' }
  }
  if (parsed.exists === false && parsed.summary) {
    return parsed
  }
  if (!parsed.summary || !Array.isArray(parsed.marketRows) || !parsed.infrastructure || !parsed.crime || !parsed.climate) {
    const missing = [
      !parsed.summary && 'summary',
      !Array.isArray(parsed.marketRows) && 'marketRows',
      !parsed.infrastructure && 'infrastructure',
      !parsed.crime && 'crime',
      !parsed.climate && 'climate',
    ].filter(Boolean).join(', ')
    throw new Error(`The model returned JSON missing required fields: ${missing}. Try running again.`)
  }
  // Always compute scores from structured data — never trust LLM-generated values
  parsed.scores = computeScores(parsed, liveBenchmarks)

  // Generate benchmark display strings from hardcoded/live benchmarks instead of relying on LLM
  const stateKey = parsed.state?.toUpperCase()
  const benchmark = (liveBenchmarks?.states[stateKey] ?? FALLBACK_BENCHMARKS[stateKey])
  if (benchmark && stateKey) {
    const city = STATE_CAPITAL_CITIES[stateKey] ?? stateKey
    const sign = (n: number) => n >= 0 ? `+${n}%` : `${n}%`
    parsed.stateMedianGrowth = sign(benchmark.annual12m)
    parsed.capitalCityGrowth = `${city} ${sign(benchmark.annual12m)}`
    parsed.stateMedianGrowth5yr = `${sign(benchmark.cumulative5yr)} cumulative`
    parsed.capitalCityGrowth5yr = `${city} ${sign(benchmark.cumulative5yr)} cumulative`
  }

  return parsed
}

export const parseReferenceLink = (reference: string) => {
  const trimmed = reference.trim()
  const markdownLink = trimmed.match(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/i)
  if (markdownLink) {
    return { label: markdownLink[1].trim(), url: markdownLink[2].trim() }
  }
  const urlMatch = trimmed.match(/https?:\/\/[^\s)\]]+/i)
  if (!urlMatch) return { label: trimmed, url: '' }
  const url = urlMatch[0].replace(/[.,;:]+$/, '')
  const label = trimmed.replace(urlMatch[0], '').replace(/[\s,;:-]+$/, '').trim()
  return { label: label || url, url }
}

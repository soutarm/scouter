import type { Review } from '../types'

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
  // then strip any trailing comma or partial key before closing.
  let trimmed = s.slice(0, lastSafeOutsideString + 1).trimEnd()
  trimmed = trimmed.replace(/,\s*$/, '')

  return trimmed + stack.reverse().join('')
}

export const parseReview = (content: string): Review => {
  const stripped = stripJsonFence(content)
  let parsed: Review
  try {
    parsed = JSON.parse(stripped) as Review
  } catch (e) {
    try {
      parsed = JSON.parse(repairTruncatedJson(stripped)) as Review
    } catch {
      const snippet = stripped.slice(0, 300).replace(/\n/g, ' ')
      throw new Error(`The model returned invalid JSON. Parse error: ${e instanceof Error ? e.message : e}. Content preview: ${snippet}`)
    }
  }
  // Handle legacy string crime field from cached/old responses
  if (typeof parsed.crime === 'string') {
    parsed.crime = { narrative: parsed.crime as unknown as string, insuranceImpact: '' }
  }
  // Always compute overall from the five sub-scores rather than trusting the LLM value
  if (parsed.scores) {
    const { property, safety, infrastructure, demographics, environment } = parsed.scores
    const avg = (property + safety + infrastructure + demographics + environment) / 5
    parsed.scores.overall = Math.round(avg * 10) / 10
  }
  if (parsed.exists === false && parsed.summary) {
    return parsed
  }
  if (!parsed.summary || !Array.isArray(parsed.marketRows) || !parsed.infrastructure) {
    throw new Error('The model returned JSON, but not the expected review shape.')
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

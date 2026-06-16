import type { Review } from '../types'
import { computeScores } from './scoring'

export const STORAGE_KEY = 'scouter.llm-settings'
export const RECENT_SEARCHES_KEY = 'scouter.recent-searches'
export const REVIEW_CACHE_KEY = 'scouter.review-cache'
export const REVIEW_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day
export const MAX_RECENT_SEARCHES = 12

// Increment when the scoring model changes so cached scores are recomputed on read.
const SCORES_VERSION = 4

type ReviewCacheEntry = {
  review: Review
  cachedAt: number
  scoresVersion?: number
}

type ReviewCache = Record<string, ReviewCacheEntry>

const loadReviewCache = (): ReviewCache => {
  try {
    const raw = window.localStorage.getItem(REVIEW_CACHE_KEY)
    return raw ? (JSON.parse(raw) as ReviewCache) : {}
  } catch {
    return {}
  }
}

export const getCachedReview = (query: string): Review | null => {
  const key = query.trim().toLowerCase()
  const cache = loadReviewCache()
  const entry = cache[key]
  if (!entry) return null
  if (Date.now() - entry.cachedAt > REVIEW_CACHE_TTL_MS) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { [key]: _expired, ...rest } = cache
    window.localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(rest))
    return null
  }
  // Re-score silently if the entry was cached before the current scoring model
  if ((entry.scoresVersion ?? 0) < SCORES_VERSION && entry.review.exists !== false) {
    entry.review.scores = computeScores(entry.review)
    entry.scoresVersion = SCORES_VERSION
    cache[key] = entry
    try { window.localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(cache)) } catch { /* quota */ }
  }
  return entry.review
}

export const setCachedReview = (query: string, review: Review) => {
  const key = query.trim().toLowerCase()
  const cache = loadReviewCache()
  cache[key] = { review, cachedAt: Date.now(), scoresVersion: SCORES_VERSION }
  try {
    window.localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(cache))
  } catch {
    // localStorage quota exceeded — silently skip caching
  }
}

export const clearReviewCache = () => {
  window.localStorage.removeItem(REVIEW_CACHE_KEY)
}

export const getReviewCacheCount = () => {
  const cache = loadReviewCache()
  const now = Date.now()
  const validEntries = Object.entries(cache).filter(([, entry]) => now - entry.cachedAt <= REVIEW_CACHE_TTL_MS)

  if (validEntries.length !== Object.keys(cache).length) {
    window.localStorage.setItem(REVIEW_CACHE_KEY, JSON.stringify(Object.fromEntries(validEntries)))
  }

  return validEntries.length
}

export const loadSettings = <T>(storageKey: string, defaults: T): T => {
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return defaults
    return { ...defaults, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return defaults
  }
}

export const saveSettings = <T>(storageKey: string, settings: T) => {
  window.localStorage.setItem(storageKey, JSON.stringify(settings))
}

export const loadRecentSearches = (): string[] => {
  try {
    const raw = window.localStorage.getItem(RECENT_SEARCHES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_RECENT_SEARCHES)
      : []
  } catch {
    return []
  }
}

export const saveRecentSearches = (searches: string[]) => {
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches))
}

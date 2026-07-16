import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import './App.css'

import type { AustralianState, DemographicDatum, LlmSettings, Review, ReviewSectionKey, SuburbSuggestion } from './types'
import {
   STORAGE_KEY, MAX_RECENT_SEARCHES,
  clearReviewCache, removeCachedReview, getCachedReview, getCachedReviewKeys, getReviewCacheCount, setCachedReview,
  loadRecentSearches, saveRecentSearches,
} from './services/cache'
import {
  featuredQuickLocations,
  mapStateName, splitLocation,
  readSearchFromQueryString, writeSearchToQueryString,
  getSuggestedLocation,
} from './services/location'
import { callLlm, fetchBenchmarks, fetchHomelyContext } from './services/llm'
import { fetchOsmContext } from './services/osm'
import { buildShareUrl, clearSharedReviewHash, fetchReviewById, getSharedReviewFromHash, SHARED_REVIEW_HASH_KEY, storeReview } from './services/share'
import { parseReferenceLink } from './services/reviewParser'
import { SettingsPanel } from './components/SettingsPanel'
import { HeroSearchSection } from './components/HeroSearchSection'
import { PropertyTab } from './components/review/PropertyTab'
import { EnvironmentTab } from './components/review/EnvironmentTab'
import { CrimeTab } from './components/review/CrimeTab'
import { InfrastructureTab } from './components/review/InfrastructureTab'
import { DemographicsTab } from './components/review/DemographicsTab'
import { MapTab } from './components/review/MapTab'
import { SharedReviewBanner } from './components/review/SharedReviewBanner'
import { ScoreRing } from './components/review/ScoreRing'
import { TabPageHeader } from './components/review/TabPageHeader'
import { ComparePanel } from './components/review/ComparePanel'
import { BusyIconMorph } from './components/BusyIconMorph'
import { PropertyIcon, SafetyIcon, InfrastructureIcon, DemographicsIcon, EnvironmentIcon, MapIcon } from './components/TabIcons'
import { extractTemperatureProfile } from './components/review/ThermometerRange'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const defaultSettings: LlmSettings = {
  provider: 'azure',
  azureEndpoint: '',
  azureDeployment: '',
  azureApiKey: '',
  azureApiVersion: '2025-04-01-preview',
  openAiBaseUrl: 'https://api.openai.com/v1',
  openAiModel: 'gpt-5.4-mini',
  openAiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  geminiApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicApiKey: '',
  deepseekModel: 'deepseek-v4-flash',
  deepseekApiKey: '',
}

const LEVEL_STEPS: Record<'Low' | 'Medium' | 'High' | 'Very High', number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  'Very High': 4,
}

const LEVEL_COLORS: Record<'Low' | 'Medium' | 'High' | 'Very High', [number, number, number]> = {
  Low: [79, 143, 102],
  Medium: [212, 168, 67],
  High: [192, 112, 59],
  'Very High': [176, 48, 32],
}

const loadSettings = (): LlmSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultSettings
    const parsed = JSON.parse(raw) as Partial<LlmSettings>
    const merged = { ...defaultSettings, ...parsed }
    return {
      ...merged,
      openAiModel: merged.openAiModel?.trim() || defaultSettings.openAiModel,
      geminiModel: merged.geminiModel?.trim() || defaultSettings.geminiModel,
      anthropicModel: merged.anthropicModel?.trim() || defaultSettings.anthropicModel,
      deepseekModel: merged.deepseekModel?.trim() || defaultSettings.deepseekModel,
    }
  } catch {
    return defaultSettings
  }
}

const saveSettings = (settings: LlmSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

// ---------------------------------------------------------------------------
// Tab icons
// ---------------------------------------------------------------------------


const TAB_ICONS: Record<ReviewSectionKey, React.ReactNode> = {
  property: <PropertyIcon />,
  crime: <SafetyIcon />,
  infrastructure: <InfrastructureIcon />,
  demographics: <DemographicsIcon />,
  environment: <EnvironmentIcon />,
  map: <MapIcon />,
}

const tabs: Array<{ key: ReviewSectionKey; label: string }> = [
  { key: 'property', label: 'Property' },
  { key: 'crime', label: 'Crime & Safety' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'environment', label: 'Environment' },
  { key: 'demographics', label: 'Demographics' },
  { key: 'map', label: 'Map' },
]

const providerLabelByKind: Record<LlmSettings['provider'], string> = {
  azure: 'Azure AI',
  openai: 'OpenAI GPT',
  gemini: 'Google Gemini',
  anthropic: 'Anthropic Claude',
  deepseek: 'DeepSeek',
}

const getConfiguredModelName = (settings: LlmSettings): string => {
  if (settings.provider === 'azure') return settings.azureDeployment.trim()
  if (settings.provider === 'gemini') return settings.geminiModel.trim()
  if (settings.provider === 'anthropic') return settings.anthropicModel.trim()
  if (settings.provider === 'deepseek') return settings.deepseekModel.trim()
  return settings.openAiModel.trim()
}

const collapseGrowthRange = (value: string): string => {
  const stripped = value.replace(/\s/g, '')
  const m = stripped.match(/([+-]?\d+(?:\.\d+)?)%[^%]*?([+-]?\d+(?:\.\d+)?)%/)
  if (!m) return value
  const avg = (parseFloat(m[1]) + parseFloat(m[2])) / 2
  const sign = avg >= 0 ? '+' : ''
  const formatted = avg % 1 === 0 ? `${avg.toFixed(0)}%` : `${avg.toFixed(1)}%`
  return `${sign}${formatted}`
}

const formatErrorDetails = (caught: unknown): string => {
  if (caught instanceof Error) return caught.stack || caught.message
  if (caught instanceof DOMException) return `${caught.name}: ${caught.message}`
  if (typeof caught === 'string') return caught

  try {
    return JSON.stringify(caught, null, 2) ?? 'No technical details were available.'
  } catch {
    return 'No technical details were available.'
  }
}

const ErrorNotice = ({ message, details }: { message: string; details?: string }) => (
  <section className="error-card" role="alert" aria-live="polite">
    <div className="error-card-header">
      <div>
        <p className="eyebrow">Something needs attention</p>
        <h2>{message}</h2>
      </div>
    </div>
    <p className="error-card-copy">
      {details
        ? 'You can try again, check your provider settings, or open the details below if you need the technical error.'
        : 'You can try again or check your provider settings before continuing.'}
    </p>
    {details && (
      <details className="error-details">
        <summary>View full error details</summary>
        <pre>{details}</pre>
      </details>
    )}
  </section>
)

// ---------------------------------------------------------------------------
// Misc UI helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const [query, setQuery] = useState('')
  const [canonicalPlace, setCanonicalPlace] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<AustralianState>('TAS')
  const [settings, setSettings] = useState<LlmSettings>(() => loadSettings())
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches())
  const [showSettings, setShowSettings] = useState(false)
  const [settingsFromMobile, setSettingsFromMobile] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(true)
  const [review, setReview] = useState<Review | null>(null)
  const [activeTab, setActiveTab] = useState<ReviewSectionKey>('property')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')
  const [errorDetails, setErrorDetails] = useState('')
  const [saveStatus, setSaveStatus] = useState('Loaded from this browser')
  const [cacheLocationCount, setCacheLocationCount] = useState(() => getReviewCacheCount())
  const [cacheCleared, setCacheCleared] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [compareKeys, setCompareKeys] = useState<string[]>([])
  const [isSharedReview, setIsSharedReview] = useState(() => {
    // True if arriving via /r/:id path OR legacy hash link
    if (/^\/r\/[A-Za-z0-9_-]{6,20}$/.test(window.location.pathname)) return true
    return Boolean(new URLSearchParams(window.location.hash.slice(1)).get(SHARED_REVIEW_HASH_KEY))
  })
  const [shareStatus, setShareStatus] = useState('')
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [suggestions, setSuggestions] = useState<SuburbSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSearchStartedRef = useRef(false)
  const reviewRef = useRef<HTMLElement | null>(null)
  const comparePanelRef = useRef<HTMLElement | null>(null)
  const tabContentRef = useRef<HTMLDivElement | null>(null)

  const providerReady = useMemo(() => {
    if (settings.provider === 'azure') return Boolean(settings.azureEndpoint && settings.azureDeployment && settings.azureApiKey)
    if (settings.provider === 'gemini') return Boolean(settings.geminiApiKey && settings.geminiModel)
    if (settings.provider === 'anthropic') return Boolean(settings.anthropicApiKey && settings.anthropicModel)
    if (settings.provider === 'deepseek') return Boolean(settings.deepseekApiKey && settings.deepseekModel)
    return Boolean(settings.openAiApiKey && settings.openAiModel)
  }, [settings])

  const quickLocationTags = useMemo(() => {
    const seen = new Set<string>()
    const uniqueRecentSearches = recentSearches.filter((search) => {
      const key = search.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, MAX_RECENT_SEARCHES)

    if (uniqueRecentSearches.length >= featuredQuickLocations.length) return uniqueRecentSearches

    // Pad with featured locations first, then any other cached-but-not-recent keys
    const cachedKeys = getCachedReviewKeys()
    const cachedExtras = cachedKeys
      .filter((k) => !seen.has(k) && !featuredQuickLocations.some((f) => f.toLowerCase() === k))
      // Capitalise each word for display (cache keys are lowercase)
      .map((k) => k.replace(/\b\w/g, (c) => c.toUpperCase()))

    return [
      ...uniqueRecentSearches,
      ...featuredQuickLocations.filter((s) => !seen.has(s.toLowerCase())),
      ...cachedExtras,
    ].slice(0, featuredQuickLocations.length)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentSearches, cacheLocationCount])

  // Up to 8 cached locations shown in compare mode, most-recent first
  const compareLocationTags = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const s of recentSearches) {
      const key = s.trim().toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      if (getCachedReview(key) !== null) out.push(s)
      if (out.length >= 8) break
    }
    return out
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentSearches, cacheLocationCount])

  const composedQuery = query.trim() ? `${query.trim()}, ${selectedState}` : ''

  const compareReviews = useMemo(() => {
    return compareKeys
      .map((key) => getCachedReview(key))
      .filter((r): r is Review => r !== null && r.exists !== false)
  }, [compareKeys])
  const locationNotFound = review?.exists === false
  const suggestedLocation = getSuggestedLocation(review)
  const viewOnlyMode = isSharedReview && !providerReady
  const canUseSearchActions = !viewOnlyMode
  const providerLabel = review?.sourceProvider ? providerLabelByKind[review.sourceProvider] : ''
  const modelLabel = review?.sourceModel?.trim() || ''
  const placeLabel = query.trim() || 'this suburb'
  const placePossessive = /s$/i.test(placeLabel) ? `${placeLabel}'` : `${placeLabel}'s`
  const busyMessages = useMemo(() => {
    const locationLabel = composedQuery || 'this location'
    return [
      `Scouting ${locationLabel}...`,
      `Mapping ${placePossessive} infrastructure...`,
      `Checking transport links around ${placeLabel}...`,
      `Reviewing ${placePossessive} climate and noise profile...`,
      `Sizing up ${placePossessive} market momentum...`,
      `Investigating crime trends in ${placeLabel}...`,
      `Cross-checking safety signals for ${placeLabel}...`,
    ]
  }, [composedQuery, placeLabel, placePossessive])
  const [busyMessageIndex, setBusyMessageIndex] = useState(0)

  const updateSettings = (next: LlmSettings) => {
    setSettings(next)
    saveSettings(next)
    setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  }

  const rememberSearch = useCallback((search: string) => {
    const normalized = search.trim()
    if (!normalized) return
    setRecentSearches((current) => {
      const next = [
        normalized,
        ...current.filter((item) => item.trim().toLowerCase() !== normalized.toLowerCase()),
      ].slice(0, MAX_RECENT_SEARCHES)
      saveRecentSearches(next)
      return next
    })
  }, [])

  const clearError = useCallback(() => {
    setError('')
    setErrorDetails('')
  }, [])

  const showError = useCallback((message: string, details?: unknown) => {
    setError(message)
    setErrorDetails(details === undefined ? '' : formatErrorDetails(details))
  }, [])

  const fetchSuggestions = useCallback((value: string) => {
    if (suggestionsDebounceRef.current) clearTimeout(suggestionsDebounceRef.current)
    const trimmed = value.trim()
    if (trimmed.length < 2) { setSuggestions([]); setShowSuggestions(false); return }

    suggestionsDebounceRef.current = setTimeout(async () => {
      try {
        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&limit=8&lang=en&bbox=96.82,-43.74,168.0,-9.14`
        const res = await fetch(url)
        if (!res.ok) return
        const data = await res.json() as { features?: Array<{ properties: { name?: string; state?: string; postcode?: string; type?: string; osm_value?: string } }> }
        const relevant = ['suburb', 'city', 'town', 'village', 'locality', 'quarter', 'borough']
        const results: SuburbSuggestion[] = (data.features ?? [])
          .filter((f) => {
            const p = f.properties
            return p.name && p.state && mapStateName(p.state) && (relevant.includes(p.type ?? '') || relevant.includes(p.osm_value ?? ''))
          })
          .map((f) => ({
            name: f.properties.name!,
            state: mapStateName(f.properties.state!)!,
            postcode: f.properties.postcode ?? '',
          }))
          .filter((item, idx, arr) => arr.findIndex((x) => x.name === item.name && x.state === item.state) === idx)
          .slice(0, 6)
        setSuggestions(results)
        setShowSuggestions(results.length > 0)
      } catch {
        // Silently fail - autocomplete is best-effort
      }
    }, 280)
  }, [])

  const runSearch = useCallback(
    async (place: string, state: AustralianState, options: { updateQueryString?: boolean; tab?: string } = {}) => {
      const trimmedPlace = place.trim()
      const trimmedQuery = trimmedPlace ? `${trimmedPlace}, ${state}` : ''
      if (!trimmedQuery) return

      // Use the canonical (autocomplete-provided) name if available, else raw input
      const displayPlace = canonicalPlace ?? trimmedPlace
      setQuery(displayPlace)
      setCanonicalPlace(null)
      setSelectedState(state)
      setShareStatus('')

      if (options.updateQueryString !== false) writeSearchToQueryString(trimmedPlace, state, options.tab)

      if (isSharedReview) {
        clearSharedReviewHash()
        setIsSharedReview(false)
      }

      if (!providerReady) {
        setShowSettings(true)
        showError('Add your provider settings before scouting a suburb.')
        return
      }

      const cached = getCachedReview(trimmedQuery)
      if (cached) {
        setHasSearched(true)
        setIsSearchOpen(false)
        setReview(cached)
        clearError()
        setActiveTab((options.tab as ReviewSectionKey) ?? 'property')
        setShowReferences(false)
        return
      }

      setIsLoading(true)
      clearError()
      setShowReferences(false)
      setReview(null)
      setActiveTab((options.tab as ReviewSectionKey) ?? 'property')
      setHasSearched(true)
      setIsSearchOpen(false)
      try {
        const [homelyContext, liveBenchmarks, osmContext] = await Promise.all([
          fetchHomelyContext(trimmedPlace, state),
          fetchBenchmarks(),
          fetchOsmContext(trimmedPlace, state),
        ])
        const result = await callLlm(settings, trimmedQuery, homelyContext, liveBenchmarks ?? undefined, osmContext ?? undefined)
        const nextReview = {
          ...result,
          generatedAt: result.generatedAt || new Date().toISOString(),
          sourceProvider: settings.provider,
          sourceModel: getConfiguredModelName(settings),
        }
        setReview(nextReview)
        if (nextReview.exists !== false) {
          rememberSearch(trimmedQuery)
          setCachedReview(trimmedQuery, nextReview)
          setCacheLocationCount(getReviewCacheCount())
          // If compare mode is active and there's room, auto-add this location and scroll to panel
          const cacheKey = trimmedQuery.toLowerCase()
          setCompareKeys((prev) => {
            if (compareMode && prev.length < 6 && !prev.includes(cacheKey)) {
              setTimeout(() => {
                comparePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }, 120)
              return [...prev, cacheKey]
            }
            return prev
          })
        }
      } catch (caught) {
        showError('We could not generate that review.', caught)
      } finally {
        setIsLoading(false)
      }
    },
    [canonicalPlace, clearError, isSharedReview, providerReady, rememberSearch, settings, compareMode, showError],
  )

  useEffect(() => {
    // --- New: /r/:id path-based shared review ---
    const idMatch = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{6,20})$/)
    if (idMatch) {
      autoSearchStartedRef.current = true
      setIsSharedReview(true)
      setHasSearched(true)
      setIsSearchOpen(false)
      setIsLoading(true)
      fetchReviewById(idMatch[1]).then((fetched) => {
        if (fetched) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setReview(fetched)
          setQuery(fetched.suburb)
          setSelectedState((fetched.state as AustralianState) ?? 'TAS')
        } else {
          showError('We could not find that shared review.', 'The shared review may have expired or the link may be incorrect.')
          setIsSharedReview(false)
        }
        setActiveTab('property')
        setShowReferences(false)
        setIsLoading(false)
      }).catch((caught) => {
        showError('We could not load this shared review.', caught)
        setIsSharedReview(false)
        setIsLoading(false)
      })
      return
    }

    // --- Legacy: hash-based shared review ---
    const sharedReview = getSharedReviewFromHash(window.location.hash)
    if (!sharedReview) return

    autoSearchStartedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReview(sharedReview)
    setHasSearched(true)
    setIsSearchOpen(false)
    setActiveTab('property')
    setShowReferences(false)
    clearError()
    setIsSharedReview(true)
    setQuery(sharedReview.suburb)
    setSelectedState((sharedReview.state as AustralianState) ?? 'TAS')
  }, [clearError, showError])

  useEffect(() => {
    if (autoSearchStartedRef.current) return
    const initialSearch = readSearchFromQueryString()
    if (!initialSearch?.place) return
    const initialState = initialSearch.state ?? selectedState
    autoSearchStartedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runSearch(initialSearch.place, initialState, { tab: initialSearch.tab })
  }, [runSearch, selectedState])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!isLoading) { setBusyMessageIndex(0); return }
    setBusyMessageIndex(0)
    const intervalId = window.setInterval(() => {
      setBusyMessageIndex((current) => (current + 1) % busyMessages.length)
    }, 2600)
    return () => window.clearInterval(intervalId)
  }, [busyMessages.length, isLoading])

  // Scroll to review section when a new result arrives
  useEffect(() => {
    if (!review || !reviewRef.current) return
    // Small delay so the DOM has painted the review card before scrolling
    const id = setTimeout(() => {
      reviewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
    return () => clearTimeout(id)
  }, [review])



  // Update page title based on active review
  useEffect(() => {
    if (review?.exists && review.suburb && review.state) {
      document.title = `Scouter: ${review.suburb}, ${review.state}`
    } else {
      document.title = 'Scouter'
    }
  }, [review])

  useEffect(() => {
    if (!viewOnlyMode) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompareMode(false)
    setCompareKeys([])
  }, [viewOnlyMode])

  const clearSearchFromUrl = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    params.delete('search')
    params.delete('state')
    const nextSearch = params.toString()
    window.history.replaceState(null, '', `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`)
  }, [])

  const openSearchPanel = useCallback(() => {
    setIsSearchOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const removeLocation = useCallback((search: string) => {
    const key = search.trim().toLowerCase()
    removeCachedReview(key)
    const next = recentSearches.filter((s) => s.trim().toLowerCase() !== key)
    saveRecentSearches(next)
    setRecentSearches(next)
    setCacheLocationCount(getReviewCacheCount())
  }, [recentSearches])

  const clearCurrentLocation = useCallback(() => {
    if (composedQuery) removeLocation(composedQuery)
    setQuery('')
    setReview(null)
    setIsSharedReview(false)
    setHasSearched(false)
    openSearchPanel()
    setActiveTab('property')
    clearError()
    setShowReferences(false)
    setSuggestions([])
    setShowSuggestions(false)
    clearSearchFromUrl()
    clearSharedReviewHash()
  }, [clearError, clearSearchFromUrl, composedQuery, openSearchPanel, removeLocation])

  const clearCacheAndRecentSearches = useCallback(() => {
    clearReviewCache()
    saveRecentSearches([])
    setRecentSearches([])
    setCacheLocationCount(0)
    setCacheCleared(true)
    clearCurrentLocation()
    setSaveStatus('Cache cleared')
    setTimeout(() => setCacheCleared(false), 3000)
  }, [clearCurrentLocation])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedQuery = splitLocation(query)
    const place = parsedQuery.place
    const state = parsedQuery.state ?? selectedState
    if (!place) return
    await runSearch(place, state)
  }

  const handleSharedSearchIntent = useCallback(() => {
    if (!viewOnlyMode) return
    setShowSettings(true)
    showError('Add your provider settings to run your own search.')
  }, [showError, viewOnlyMode])

  const handleCreateOwnReview = useCallback(() => {
    clearSharedReviewHash()
    setIsSharedReview(false)
    setReview(null)
    setHasSearched(false)
    setIsSearchOpen(true)
    clearError()
    setActiveTab('property')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [clearError])

  const handleShare = useCallback(async () => {
    if (!review || locationNotFound) return
    const title = `Scouter: ${review.suburb}, ${review.state}`

    setShareStatus('Generating link...')
    let url: string
    try {
      const id = await storeReview(review)
      url = buildShareUrl(id)
    } catch (caught) {
      setShareStatus('')
      showError('We could not create a share link.', caught)
      return
    }

    try {
      if (navigator.share) {
        await navigator.share({ title, url })
        setShareStatus('Shared')
      } else {
        await navigator.clipboard.writeText(url)
        setShareStatus('Link copied')
      }
      window.setTimeout(() => setShareStatus(''), 2200)
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setShareStatus('')
        return
      }
      showError('We could not share this review.', caught)
      setShareStatus('')
    }
  }, [locationNotFound, review, showError])

  const downloadPdf = async () => {
    if (!review || viewOnlyMode) return
    setIsExporting(true)
    clearError()
    try {
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pageWidth = pdf.internal.pageSize.getWidth()
      const pageHeight = pdf.internal.pageSize.getHeight()
      const margin = 16
      const maxWidth = pageWidth - margin * 2
      let y = 18

      const paintPageBackground = () => {
        pdf.setFillColor(248, 251, 244)
        pdf.rect(0, 0, pageWidth, pageHeight, 'F')
      }

      const ensureSpace = (height: number) => {
        if (y + height > pageHeight - margin) {
          pdf.addPage()
          paintPageBackground()
          y = margin
        }
      }

      const write = (text: string, size = 10, style: 'normal' | 'bold' = 'normal', gap = 5) => {
        pdf.setFont('helvetica', style)
        pdf.setFontSize(size)
        const lineHeight = size * 0.42
        const allLines = pdf.splitTextToSize(text || '', maxWidth) as string[]
        const lines = allLines.length ? allLines : ['']

        let cursor = 0
        while (cursor < lines.length) {
          const availableHeight = pageHeight - margin - y
          const linesThatFit = Math.max(1, Math.floor(availableHeight / lineHeight))
          const chunk = lines.slice(cursor, cursor + linesThatFit)
          pdf.text(chunk, margin, y)
          y += chunk.length * lineHeight
          cursor += chunk.length
          if (cursor < lines.length) ensureSpace(lineHeight)
        }
        y += gap
      }

      const section = (heading: string, body: string) => {
        y += 2
        write(heading, 13, 'bold', 4)
        if (body.trim()) write(body, 10, 'normal', 7)
      }

      const scoreColor = (s: number): [number, number, number] =>
        s >= 8 ? [127, 212, 154] : s >= 6 ? [168, 201, 160] : s >= 4 ? [212, 168, 67] : [192, 112, 96]

      const drawArcRing = (cx: number, cy: number, radius: number, width: number, score: number, color: [number, number, number]) => {
        const startDeg = 135
        const sweepDeg = 270
        const step = 3

        pdf.setDrawColor(222, 231, 220)
        pdf.setLineWidth(width)
        for (let deg = startDeg; deg < startDeg + sweepDeg; deg += step) {
          const a1 = (deg * Math.PI) / 180
          const a2 = ((deg + step) * Math.PI) / 180
          pdf.line(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius)
        }

        const filledTo = startDeg + (Math.max(0, Math.min(10, score)) / 10) * sweepDeg
        pdf.setDrawColor(color[0], color[1], color[2])
        for (let deg = startDeg; deg < filledTo; deg += step) {
          const a1 = (deg * Math.PI) / 180
          const a2 = ((Math.min(deg + step, filledTo)) * Math.PI) / 180
          pdf.line(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius)
        }
      }

      const drawMainScoreRing = () => {
        if (!review.scores) return false
        const blockHeight = 58
        ensureSpace(blockHeight + 2)

        const s = review.scores
        const centerX = margin + 28
        const centerY = y + 28
        const overallColor = scoreColor(s.overall)

        pdf.setFillColor(244, 248, 240)
        pdf.roundedRect(margin, y, maxWidth, blockHeight, 4, 4, 'F')

        drawArcRing(centerX, centerY, 14, 3.2, s.overall, overallColor)
        pdf.setTextColor(36, 75, 49)
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(14)
        pdf.text(`${s.overall.toFixed(1)}`, centerX, centerY + 1.7, { align: 'center' })
        pdf.setFontSize(7)
        pdf.setFont('helvetica', 'normal')
        pdf.text('OVERALL', centerX, centerY + 7.5, { align: 'center' })

        const chips: Array<{ label: string; val: number }> = [
          { label: 'PROPERTY', val: s.property },
          { label: 'SAFETY', val: s.safety },
          { label: 'INFRA', val: s.infrastructure },
          { label: 'ENV', val: s.environment },
        ]
        const startX = margin + 62
        const chipGap = (maxWidth - 70) / 4

        chips.forEach((chip, i) => {
          const x = startX + i * chipGap
          const c = scoreColor(chip.val)
          drawArcRing(x, centerY - 2, 7.2, 2, chip.val, c)
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(8)
          pdf.setTextColor(36, 75, 49)
          pdf.text(String(chip.val), x, centerY - 1, { align: 'center' })
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(6.2)
          pdf.text(chip.label, x, centerY + 10, { align: 'center' })
        })

        pdf.setTextColor(0, 0, 0)
        y += blockHeight + 5
        return true
      }

      const drawTemperatureSlider = (label: string, description: string) => {
        const profile = extractTemperatureProfile(description)
        if (!profile) return false

        const cardHeight = 22
        ensureSpace(cardHeight + 2)

        const trackX = margin + 22
        const trackY = y + 12
        const trackW = maxWidth - 44

        const toPos = (value: number) => {
          const clamped = Math.min(50, Math.max(-10, value))
          return ((clamped + 10) / 60) * trackW
        }

        const minX = trackX + toPos(profile.min)
        const maxX = trackX + toPos(profile.max)
        const peakX = profile.peak != null ? trackX + toPos(profile.peak) : null

        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.text(label, margin, y + 4)

        pdf.setDrawColor(210, 219, 208)
        pdf.setLineWidth(1.8)
        pdf.line(trackX, trackY, trackX + trackW, trackY)

        pdf.setDrawColor(79, 143, 102)
        pdf.setLineWidth(2.8)
        pdf.line(minX, trackY, maxX, trackY)

        pdf.setFillColor(79, 143, 102)
        pdf.circle(minX, trackY, 1.2, 'F')
        pdf.circle(maxX, trackY, 1.2, 'F')

        if (peakX != null) {
          pdf.setFillColor(176, 48, 32)
          pdf.circle(peakX, trackY, 1.1, 'F')
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(6)
          pdf.text('HW', peakX, trackY - 2.2, { align: 'center' })
        }

        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(7)
        pdf.text('-10°C', trackX, trackY + 4.4)
        pdf.text('50°C', trackX + trackW, trackY + 4.4, { align: 'right' })

        const peakText = profile.peak != null ? ` · HW ${Math.round(profile.peak)}°C` : ''
        pdf.text(`${Math.round(profile.min)}°C → ${Math.round(profile.max)}°C${peakText}`, margin, y + 19)

        y += cardHeight
        return true
      }

      const drawLevelDots = (title: string, rows: Array<{ label: string; level: 'Low' | 'Medium' | 'High' | 'Very High' }>) => {
        if (!rows.length) return false
        const rowH = 6.2
        const boxHeight = 8 + rows.length * rowH
        ensureSpace(boxHeight + 2)

        pdf.setFillColor(244, 248, 240)
        pdf.roundedRect(margin, y, maxWidth, boxHeight, 2.5, 2.5, 'F')

        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.text(title, margin + 3, y + 4.5)

        rows.forEach((row, index) => {
          const rowY = y + 8.5 + index * rowH
          const dotXStart = margin + maxWidth - 29
          const filled = LEVEL_STEPS[row.level]
          const color = LEVEL_COLORS[row.level]

          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(8)
          pdf.text(row.label, margin + 3, rowY)

          pdf.setTextColor(color[0], color[1], color[2])
          pdf.text(row.level, margin + maxWidth - 35, rowY, { align: 'right' })

          for (let step = 1; step <= 4; step += 1) {
            if (step <= filled) pdf.setFillColor(color[0], color[1], color[2])
            else pdf.setFillColor(219, 226, 216)
            pdf.circle(dotXStart + (step - 1) * 4.8, rowY - 1.2, 1.25, 'F')
          }
        })

        pdf.setTextColor(0, 0, 0)
        y += boxHeight + 2
        return true
      }

      const drawDemographicBars = (title: string, data: DemographicDatum[] | undefined) => {
        if (!data?.length) return false
        const rows = data.slice(0, 6)
        const rowH = 6.5
        const boxHeight = 10 + rows.length * rowH
        ensureSpace(boxHeight + 2)

        const maxVal = Math.max(...rows.map((d) => d.value), 1)
        const barX = margin + 56
        const barW = maxWidth - 68

        pdf.setFillColor(244, 248, 240)
        pdf.roundedRect(margin, y, maxWidth, boxHeight, 2.5, 2.5, 'F')
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(9)
        pdf.text(title, margin + 3, y + 5)

        rows.forEach((d, i) => {
          const rowY = y + 10 + i * rowH
          const width = (Math.max(0, d.value) / maxVal) * barW
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(7.5)
          pdf.text(d.label.slice(0, 24), margin + 3, rowY)
          pdf.setFillColor(208, 220, 203)
          pdf.roundedRect(barX, rowY - 3.2, barW, 3.5, 1.2, 1.2, 'F')
          pdf.setFillColor(79, 143, 102)
          pdf.roundedRect(barX, rowY - 3.2, Math.max(1.5, width), 3.5, 1.2, 1.2, 'F')
          pdf.setFontSize(7)
          pdf.text(`${d.value}%`, barX + barW + 1.5, rowY, { align: 'left' })
        })

        y += boxHeight + 2
        return true
      }

      paintPageBackground()
      write(`${review.suburb}, ${review.state} Profile`, 20, 'bold', 7)
      write(review.summary, 11, 'normal', 8)

      drawMainScoreRing()

      section('Property Market & Rental Realities', review.marketNarrative)
      review.marketRows.forEach((row) => {
        const growthStr = row.fiveYearGrowth
          ? `${collapseGrowthRange(row.twelveMonthGrowth)} (12-month), ${collapseGrowthRange(row.fiveYearGrowth)} (5-year)`
          : collapseGrowthRange(row.twelveMonthGrowth)
        write(`${row.propertyType}: ${row.medianPrice}, ${growthStr} growth, ${row.medianWeeklyRent} rent, ${row.grossYield} yield`, 9, 'normal', 3)
      })

      section('Climate & Environment', [
        `Summer: ${review.climate.summerAverages}`,
        `Winter: ${review.climate.winterAverages}`,
        review.climate.airQuality
          ? `\nAir Quality (${review.climate.airQuality.overallRating}): ${review.climate.airQuality.overallSummary}\nParticulate matter: ${review.climate.airQuality.particulateMatter}\nOzone: ${review.climate.airQuality.ozone}\nPollen: ${review.climate.airQuality.pollen}\nIndustrial pollution: ${review.climate.airQuality.industrialPollution}`
          : '',
        review.climate.noise
          ? `\nNoise & Amenity (${review.climate.noise.overallRating}): ${review.climate.noise.overallSummary}\nFlight paths: ${review.climate.noise.flightPath}\nRail: ${review.climate.noise.railNoise}\nRoad: ${review.climate.noise.roadNoise}\nIndustrial: ${review.climate.noise.industrialZones}`
          : '',
        ].filter(Boolean).join('\n\n'))

      y += 1
      write('Climate visuals', 11, 'bold', 3)
      const drewSummer = drawTemperatureSlider('Summer temperature range', review.climate.summerAverages)
      const drewWinter = drawTemperatureSlider('Winter temperature range', review.climate.winterAverages)
      if (!drewSummer && !drewWinter) write('Temperature range unavailable.', 8.5, 'normal', 4)

      if (review.climate.airQuality) {
        drawLevelDots('Air quality level meters', [
          { label: 'Particulate matter', level: review.climate.airQuality.particulateMatterLevel },
          { label: 'Ozone', level: review.climate.airQuality.ozoneLevel },
          { label: 'Pollen', level: review.climate.airQuality.pollenLevel },
          { label: 'Industrial pollution', level: review.climate.airQuality.industrialPollutionLevel },
          { label: 'Overall', level: review.climate.airQuality.overallRating },
        ])
      }

      if (review.climate.noise) {
        drawLevelDots('Noise level meters', [
          { label: 'Flight paths', level: review.climate.noise.flightPathLevel },
          { label: 'Rail noise', level: review.climate.noise.railNoiseLevel },
          { label: 'Road noise', level: review.climate.noise.roadNoiseLevel },
          { label: 'Industrial zones', level: review.climate.noise.industrialZonesLevel },
          { label: 'Overall', level: review.climate.noise.overallRating },
        ])
      }

      section('Safety & Insurance', [
        review.crime.narrative,
        review.crime.insuranceImpact ? `\nInsurance impact: ${review.crime.insuranceImpact}` : '',
        review.crime.estimatedAnnualPremiums
          ? `\nEstimated annual premiums:\n${Object.entries(review.crime.estimatedAnnualPremiums).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n\n'))

      if (review.crime.crimeTypes?.length) {
        drawLevelDots('Crime type levels', review.crime.crimeTypes.map((ct) => ({ label: ct.label, level: ct.level })))
      }

      if (review.crime.naturalRisks?.length) {
        drawLevelDots('Natural hazard risks', review.crime.naturalRisks.map((r) => ({ label: r.label, level: r.level })))
      }

      section('Infrastructure, Education & Logistics', [
        review.infrastructure.cbdDistanceKm != null ? `CBD distance: ${review.infrastructure.cbdDistanceKm} km (${review.infrastructure.cbdCommuteMinutes ?? '?'} min commute)` : '',
        review.infrastructure.trainStations?.length ? `Train stations: ${review.infrastructure.trainStations.map(s => `${s.name} (${s.lines}${s.distanceKm != null ? `, ${s.distanceKm}km` : ''})`).join(', ')}` : '',
        review.infrastructure.tramStops ? `Tram: ${review.infrastructure.tramStops}` : '',
        review.infrastructure.busAvailability ? `Bus: ${review.infrastructure.busAvailability}` : '',
        review.infrastructure.majorRoads?.length ? `Major roads: ${review.infrastructure.majorRoads.join(', ')}` : '',
        `Transit & Commute: ${review.infrastructure.transit}`,
        `Education & Catchments: ${review.infrastructure.education}`,
        `Lifestyle & Amenities: ${review.infrastructure.lifestyle}`,
      ].filter(Boolean).join('\n\n'))

      if (review.demographics) {
        section('Demographics', [
          review.demographics.summary,
          review.demographics.population ? `Population: ${review.demographics.population}` : '',
          review.demographics.medianAge ? `Median age: ${review.demographics.medianAge}` : '',
          review.demographics.ageGroups?.length ? `Age groups: ${review.demographics.ageGroups.map((i) => `${i.label} ${i.value}%`).join(', ')}` : '',
          review.demographics.residentProfiles?.length ? `Who lives here: ${review.demographics.residentProfiles.map((i) => `${i.label} ${i.value}%`).join(', ')}` : '',
          review.demographics.householdTypes?.length ? `Household types: ${review.demographics.householdTypes.map((i) => `${i.label} ${i.value}%`).join(', ')}` : '',
          review.demographics.countryOfOrigin?.length ? `Country of origin: ${review.demographics.countryOfOrigin.map((i) => `${i.label} ${i.value}%`).join(', ')}` : '',
        ].filter(Boolean).join('\n\n'))

        const ageData = review.demographics.ageGroups?.length
          ? review.demographics.ageGroups
          : review.demographics.householdTypes
        drawDemographicBars(review.demographics.ageGroups?.length ? 'Age profile' : 'Household mix', ageData)
        drawDemographicBars('Who lives here', review.demographics.residentProfiles)
        drawDemographicBars('Housing tenure', review.demographics.tenureTypes)
        drawDemographicBars('Country of origin', review.demographics.countryOfOrigin)
        drawDemographicBars('Religion', review.demographics.religion)
      }

      if (review.caveats?.length) section('Caveats', review.caveats.map((c) => `- ${c}`).join('\n'))
      if (review.references?.length) section('References', review.references.map((r) => `- ${r}`).join('\n'))

      const fileName = `${review.suburb || 'suburb'}-${review.state || 'review'}`
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      pdf.save(`${fileName}.pdf`)
    } catch (caught) {
      showError('We could not export the PDF.', caught)
    } finally {
      setIsExporting(false)
    }
  }

  const isSticky = hasSearched && !isSearchOpen
  const cacheStatus = isLoading ? 'busy' : cacheCleared ? 'updated' : 'stale'

  return (
    <main className="app-shell">
      <header className={`topbar${isSticky ? ' is-sticky' : ''}${showSettings ? ' settings-open' : ''}`}>
        <h1 className="brand-wordmark" aria-label="Scouter" onClick={() => { window.location.href = '/' }} style={{ cursor: 'pointer' }}>
          <span className="brand-letter brand-letter-s" aria-hidden="true">S</span>
          <span className="brand-letter" aria-hidden="true">C</span>
          <span className="brand-letter" aria-hidden="true">O</span>
          <span className="brand-letter" aria-hidden="true">U</span>
          <span className="brand-letter" aria-hidden="true">T</span>
          <span className="brand-letter" aria-hidden="true">E</span>
          <span className="brand-letter brand-letter-r" aria-hidden="true">R</span>
        </h1>

        {isSticky && (
          <button
            className="topbar-search-pill"
            type="button"
            onClick={openSearchPanel}
            aria-label="Open suburb search"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
            </svg>
            <span className="topbar-search-pill-text">
              {isLoading ? 'Scouting…' : (composedQuery || 'Search')}
            </span>
            {isLoading
              ? <span className="button-spinner accordion-spinner" aria-label="Scouting" />
              : <svg className="topbar-search-pill-chevron" aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6"/></svg>
            }
          </button>
        )}

        {/* Desktop: individual action buttons */}
        <div className="topbar-actions topbar-actions--desktop">
          {review && review.exists !== false && (
            <button
              className="settings-button share-button"
              type="button"
              onClick={() => void handleShare()}
              aria-label="Share review"
              title="Share review"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="2.8" />
                <circle cx="6" cy="12" r="2.8" />
                <circle cx="18" cy="19" r="2.8" />
                <path d="M8.4 10.8 15.5 6.4M8.4 13.2l7.1 4.4" />
              </svg>
            </button>
          )}

          <div className="settings-anchor">
            <button
              className="settings-button"
              type="button"
              onClick={() => { setShowSettings((open) => !open); setSettingsFromMobile(false) }}
              aria-label="LLM settings"
              aria-expanded={showSettings}
              aria-haspopup="true"
              title="LLM settings"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile: hamburger button */}
        <button
          className="topbar-actions topbar-actions--hamburger"
          type="button"
          onClick={() => { setShowMobileMenu((v) => !v); setShowSettings(false) }}
          aria-label="Menu"
          aria-expanded={showMobileMenu}
        >
          {showMobileMenu ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="4" y1="4" x2="20" y2="20" /><line x1="20" y1="4" x2="4" y2="20" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="3" y1="7" x2="21" y2="7" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="17" x2="21" y2="17" />
            </svg>
          )}
        </button>
      </header>

      {/* Mobile menu drawer */}
      {showMobileMenu && (
        <div className="mobile-menu" role="menu">
          {review && review.exists !== false && (
            <button
              type="button"
              className="mobile-menu-item"
              role="menuitem"
              onClick={() => { void handleShare(); setShowMobileMenu(false) }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="2.8" /><circle cx="6" cy="12" r="2.8" /><circle cx="18" cy="19" r="2.8" />
                <path d="M8.4 10.8 15.5 6.4M8.4 13.2l7.1 4.4" />
              </svg>
              Share review
            </button>
          )}
          <button
            type="button"
            className="mobile-menu-item"
            role="menuitem"
            onClick={() => { setShowSettings(true); setSettingsFromMobile(true); setShowMobileMenu(false) }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            LLM settings
          </button>
        </div>
      )}
      {showMobileMenu && (
        <div className="settings-backdrop" aria-hidden="true" onClick={() => setShowMobileMenu(false)} />
      )}

      {showSettings && (
        <>
          <div className={`settings-panel-portal${isSticky ? ' settings-panel-portal--sticky' : ''}`}>
            <SettingsPanel
              settings={settings}
              providerReady={providerReady}
              saveStatus={saveStatus}
              cacheCount={cacheLocationCount}
              cacheStatus={cacheStatus}
              onUpdate={updateSettings}
              onClearCache={clearCacheAndRecentSearches}
              onClearCurrentLocation={clearCurrentLocation}
              onClose={settingsFromMobile ? () => setShowSettings(false) : undefined}
            />
          </div>
          <div
            className="settings-backdrop"
            aria-hidden="true"
            onClick={() => setShowSettings(false)}
          />
        </>
      )}

      {!isSticky && (
        <>
          <HeroSearchSection
            showSetupCta={!providerReady && !isSharedReview}
            isLoading={isLoading}
            query={query}
            showSuggestions={showSuggestions}
            suggestions={suggestions}
            quickLocationTags={quickLocationTags}
            compareMode={compareMode}
            compareKeys={compareKeys}
            compareLocationTags={compareLocationTags}
            composedQuery={composedQuery}
            showCompareControls={canUseSearchActions}
            onSubmit={handleSubmit}
            onQueryChange={(value) => {
              if (viewOnlyMode) {
                handleSharedSearchIntent()
                return
              }
              setQuery(value)
              setCanonicalPlace(null)
              fetchSuggestions(value)
            }}
            onQueryBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            onQueryFocus={() => {
              if (viewOnlyMode) {
                handleSharedSearchIntent()
                return
              }
              setQuery('')
              setSuggestions([])
              setShowSuggestions(false)
            }}
            onSuggestionSelect={(s) => {
              setSuggestions([])
              setShowSuggestions(false)
              setCanonicalPlace(s.name)
              void runSearch(s.name, s.state)
            }}
            onQuickLocationSelect={(search) => {
              if (viewOnlyMode) {
                handleSharedSearchIntent()
                return
              }
              setSuggestions([])
              setShowSuggestions(false)
              const parsed = splitLocation(search)
              if (!parsed.place) return
              void runSearch(parsed.place, parsed.state ?? selectedState)
            }}
            onCompareModeChange={(enabled) => {
              if (!canUseSearchActions) {
                handleSharedSearchIntent()
                return
              }
              setCompareMode(enabled)
              if (!enabled) {
                setCompareKeys([])
              } else {
                const currentKey = composedQuery.trim().toLowerCase()
                if (currentKey && getCachedReview(currentKey) !== null) {
                  setCompareKeys([currentKey])
                }
              }
            }}
            onToggleCompareKey={(key) => {
              setCompareKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
            }}
            onRemoveLocation={removeLocation}
            onOpenSettings={() => setShowSettings(true)}
            isRecentSearch={(search) => {
              const key = search.trim().toLowerCase()
              const isCached = getCachedReview(key) !== null
              return recentSearches.some((s) => s.trim().toLowerCase() === key) || isCached
            }}
            isCompareKeyDisabled={(key) => !compareKeys.includes(key) && compareKeys.length >= 6}
          />
        </>
      )}

      {canUseSearchActions && compareMode && compareReviews.length > 0 && (
        <div ref={comparePanelRef as React.RefObject<HTMLDivElement>}>
          <ComparePanel
            reviews={compareReviews}
            onDetails={(r) => {
              setCompareMode(false)
              setCompareKeys([])
              void runSearch(r.suburb, r.state as import('./types').AustralianState, { updateQueryString: true })
            }}
            onCategoryClick={(r, tabKey) => {
              void runSearch(r.suburb, r.state as import('./types').AustralianState, { updateQueryString: true, tab: tabKey })
            }}
            onRemove={(key) => setCompareKeys((prev) => prev.filter((k) => k !== key))}
          />
        </div>
      )}

      {isLoading && (
        <section className="busy-card" aria-live="polite">
          <div className="spinner" />
          <div className="busy-copy"><h2>{busyMessages[busyMessageIndex]}</h2></div>
          <BusyIconMorph activeIndex={busyMessageIndex} />
        </section>
      )}

      {error && <ErrorNotice message={error} details={errorDetails} />}

      {review && (
        <section className="review-wrap" ref={reviewRef}>
          <div className={showReferences ? 'references-drawer open' : 'references-drawer'}>
            <button
              type="button"
              className="references-tab"
              onClick={() => setShowReferences((v) => !v)}
              aria-expanded={showReferences}
              aria-controls="references-panel"
            >
              References
            </button>
            <section id="references-panel" className="references-panel" aria-label="All references" aria-hidden={!showReferences}>
              <div className="references-panel-header">
                <div>
                  <p className="eyebrow">References</p>
                  <h2>All references</h2>
                  {(providerLabel || modelLabel) && (
                    <p className="references-model">Model source: {[providerLabel, modelLabel].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
              </div>
              {review.references?.length ? (
                <ol>
                  {review.references.map((reference) => {
                    const parsed = parseReferenceLink(reference)
                    return (
                      <li key={reference}>
                        {parsed.url ? (
                          <a href={parsed.url} target="_blank" rel="noreferrer">{parsed.label}</a>
                        ) : parsed.label}
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="references-empty">No references are available for this review yet.</p>
              )}
            </section>
          </div>

          <div className="review-actions">
            <div>
              <p className="eyebrow">Generated review</p>
              <h2>{review.suburb}, {review.state}</h2>
            </div>
            {shareStatus && <p className="share-status" aria-live="polite">{shareStatus}</p>}
          </div>

          {isSharedReview && (
            <SharedReviewBanner onCreateOwn={handleCreateOwnReview} />
          )}

          <article className="review-card">
            {locationNotFound ? (
              <section className="not-found-card" aria-label="Location not found">
                <div className="not-found-illustration" aria-hidden="true">
                  <span className="not-found-sun" />
                  <span className="not-found-map" />
                  <span className="not-found-path" />
                  <span className="not-found-marker">?</span>
                </div>
                <div>
                  <p className="eyebrow">Location not found</p>
                  <h2>We could not scout this location.</h2>
                  <p>{review.notFoundReason || review.summary}</p>
                  <button
                    type="button"
                    className="primary-lite"
                    onClick={() => {
                      if (suggestedLocation) { void runSearch(suggestedLocation.place, suggestedLocation.state); return }
                      openSearchPanel()
                    }}
                  >
                    {suggestedLocation ? `Try ${suggestedLocation.label}` : 'Try another search'}
                  </button>
                </div>
              </section>
            ) : (
              <>
                <section className="summary-card">
                  {review.scores ? (
                    <ScoreRing
                      scores={review.scores}
                      onCategoryClick={(key) => {
                        setActiveTab(key as ReviewSectionKey)
                        // On mobile, scroll the tab content into view after the state update
                        setTimeout(() => {
                          tabContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }, 60)
                      }}
                    />
                  ) : (
                    <div>
                      <p className="eyebrow">Summary</p>
                      <h2>{review.suburb}, {review.state}</h2>
                    </div>
                  )}
                  <div className="summary-card-body">
                    {review.scores && (
                      <div className="summary-card-title">
                        <p className="eyebrow">Summary</p>
                        <h2>{review.suburb}, {review.state}</h2>
                      </div>
                    )}
                    <p>{review.summary}</p>
                    {!viewOnlyMode && (
                      <button type="button" className="summary-download primary-lite" onClick={downloadPdf} disabled={isExporting}>
                        {isExporting ? 'Preparing PDF...' : 'Download PDF'}
                      </button>
                    )}
                  </div>
                </section>

                <nav className="tabs" aria-label="Review sections">
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={`${activeTab === tab.key ? 'active' : ''}${tab.key === 'map' ? ' tab-map-btn' : ''}`}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {TAB_ICONS[tab.key]}<span className={tab.key === 'map' ? 'tab-map-label' : ''}>{tab.label}</span>
                    </button>
                  ))}
                </nav>

                <div ref={tabContentRef}>
                  <TabPageHeader
                    tabKey={activeTab}
                    scores={review.scores}
                    brief={
                      activeTab === 'property' ? review.briefs?.market
                        : activeTab === 'environment' ? review.briefs?.environment
                          : activeTab === 'crime' ? review.briefs?.crime
                            : activeTab === 'infrastructure' ? review.briefs?.infrastructure
                              : undefined
                    }
                  />
                </div>

                {activeTab === 'property' && <PropertyTab review={review} />}
                {activeTab === 'environment' && <EnvironmentTab review={review} />}
                {activeTab === 'crime' && <CrimeTab review={review} />}
                {activeTab === 'infrastructure' && <InfrastructureTab review={review} />}
                {activeTab === 'demographics' && <DemographicsTab review={review} />}
                {activeTab === 'map' && <MapTab review={review} />}
              </>
            )}

            {!locationNotFound && (review.caveats?.length || review.briefCaveats?.length) && (
              <section className="caveats">
                <div className="caveats-header">
                  <h3>Caveats</h3>
                  {!isSharedReview && composedQuery && (
                    <button
                      type="button"
                      className="regenerate-button"
                      onClick={() => {
                        removeLocation(composedQuery)
                        runSearch(review.suburb, review.state as AustralianState)
                      }}
                    >
                      Regenerate report
                    </button>
                  )}
                </div>
                <ul>
                  {(isSharedReview && review.briefCaveats?.length ? review.briefCaveats : review.caveats ?? []).map((caveat) => (
                    <li key={caveat}>{caveat}</li>
                  ))}
                  {isSharedReview && (
                    <li>This review was shared with you. Verify details independently before making decisions.</li>
                  )}
                </ul>
              </section>
            )}
          </article>
        </section>
      )}

      <footer className="site-footer">
        <p>© {new Date().getFullYear()} Michael Soutar. For research purposes only. Verify all information independently.</p>
      </footer>

    </main>
  )
}

export default App

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
  toSearchHref, getSuggestedLocation,
} from './services/location'
import { callLlm, fetchHomelyContext, friendlyRequestError } from './services/llm'
import { parseReferenceLink } from './services/reviewParser'
import { SettingsPanel } from './components/SettingsPanel'
import { PropertyTab } from './components/review/PropertyTab'
import { EnvironmentTab } from './components/review/EnvironmentTab'
import { CrimeTab } from './components/review/CrimeTab'
import { InfrastructureTab } from './components/review/InfrastructureTab'
import { DemographicsTab } from './components/review/DemographicsTab'
import { MapTab } from './components/review/MapTab'
import { ScoreRing } from './components/review/ScoreRing'
import { ComparePanel } from './components/review/ComparePanel'
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

// ---------------------------------------------------------------------------
// Misc UI helpers
// ---------------------------------------------------------------------------

const LocationPinIcon = () => (
  <svg className="location-pin" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <path d="M12 21s6.3-5.6 6.3-11.1A6.3 6.3 0 0 0 5.7 9.9C5.7 15.4 12 21 12 21Z" />
    <circle cx="12" cy="9.9" r="2.15" />
  </svg>
)

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
  const [hasSearched, setHasSearched] = useState(false)
  const [isSearchOpen, setIsSearchOpen] = useState(true)
  const [review, setReview] = useState<Review | null>(null)
  const [activeTab, setActiveTab] = useState<ReviewSectionKey>('property')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Loaded from this browser')
  const [cacheLocationCount, setCacheLocationCount] = useState(() => getReviewCacheCount())
  const [cacheCleared, setCacheCleared] = useState(false)
  const [showReferences, setShowReferences] = useState(false)
  const [compareMode, setCompareMode] = useState(false)
  const [compareKeys, setCompareKeys] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<SuburbSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSearchStartedRef = useRef(false)
  const reviewRef = useRef<HTMLElement | null>(null)
  const comparePanelRef = useRef<HTMLElement | null>(null)

  const providerReady = useMemo(() => {
    if (settings.provider === 'azure') return Boolean(settings.azureEndpoint && settings.azureDeployment && settings.azureApiKey)
    if (settings.provider === 'gemini') return Boolean(settings.geminiApiKey && settings.geminiModel)
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
        // Silently fail — autocomplete is best-effort
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

      if (options.updateQueryString !== false) writeSearchToQueryString(trimmedPlace, state, options.tab)

      if (!providerReady) {
        setShowSettings(true)
        setError('Add LLM settings before running a review.')
        return
      }

      const cached = getCachedReview(trimmedQuery)
      if (cached) {
        setHasSearched(true)
        setIsSearchOpen(false)
        setReview(cached)
        setActiveTab((options.tab as ReviewSectionKey) ?? 'property')
        setShowReferences(false)
        return
      }

      setIsLoading(true)
      setError('')
      setShowReferences(false)
      setReview(null)
      setActiveTab((options.tab as ReviewSectionKey) ?? 'property')
      setHasSearched(true)
      setIsSearchOpen(false)
      try {
        const homelyContext = await fetchHomelyContext(trimmedPlace, state)
        const result = await callLlm(settings, trimmedQuery, homelyContext)
        const nextReview = { ...result, generatedAt: result.generatedAt || new Date().toISOString() }
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
        setError(friendlyRequestError(caught))
      } finally {
        setIsLoading(false)
      }
    },
    [canonicalPlace, providerReady, rememberSearch, settings],
  )

  useEffect(() => {
    if (autoSearchStartedRef.current) return
    const initialSearch = readSearchFromQueryString()
    if (!initialSearch?.place) return
    const initialState = initialSearch.state ?? selectedState
    autoSearchStartedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void runSearch(initialSearch.place, initialState, { tab: initialSearch.tab })
  }, [runSearch, selectedState])

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
    setHasSearched(false)
    openSearchPanel()
    setActiveTab('property')
    setError('')
    setShowReferences(false)
    setSuggestions([])
    setShowSuggestions(false)
    clearSearchFromUrl()
  }, [clearSearchFromUrl, composedQuery, openSearchPanel, removeLocation])

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

  const downloadPdf = async () => {
    if (!review) return
    setIsExporting(true)
    setError('')
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
        write(`${row.propertyType}: ${row.medianPrice}, ${row.twelveMonthGrowth} growth, ${row.medianWeeklyRent} rent, ${row.grossYield} yield`, 9, 'normal', 3)
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

      section('Infrastructure, Education & Logistics', [
        review.infrastructure.cbdDistanceKm != null ? `CBD distance: ${review.infrastructure.cbdDistanceKm} km (${review.infrastructure.cbdCommuteMinutes ?? '?'} min commute)` : '',
        review.infrastructure.trainStations?.length ? `Train stations: ${review.infrastructure.trainStations.map(s => `${s.name} (${s.lines})`).join(', ')}` : '',
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
      }

      if (review.caveats?.length) section('Caveats', review.caveats.map((c) => `- ${c}`).join('\n'))
      if (review.references?.length) section('References', review.references.map((r) => `- ${r}`).join('\n'))

      const fileName = `${review.suburb || 'suburb'}-${review.state || 'review'}`
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      pdf.save(`${fileName}.pdf`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PDF export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  const isSticky = hasSearched && !isSearchOpen
  const cacheStatus = isLoading ? 'busy' : cacheCleared ? 'updated' : 'stale'

  return (
    <main className="app-shell">
      <header className={`topbar${isSticky ? ' is-sticky' : ''}${showSettings ? ' settings-open' : ''}`}>
        <h1 className="brand-wordmark" aria-label="Scouter">
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

        <div className="settings-anchor">
          <button
            className="settings-button"
            type="button"
            onClick={() => setShowSettings((open) => !open)}
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

          {showSettings && (
            <SettingsPanel
              settings={settings}
              providerReady={providerReady}
              saveStatus={saveStatus}
              cacheCount={cacheLocationCount}
              cacheStatus={cacheStatus}
              onUpdate={updateSettings}
              onClearCache={clearCacheAndRecentSearches}
              onClearCurrentLocation={clearCurrentLocation}
            />
          )}
        </div>
      </header>

      {showSettings && (
        <div
          className="settings-backdrop"
          aria-hidden="true"
          onClick={() => setShowSettings(false)}
        />
      )}

      {!isSticky && (
        <section className="hero-panel">
          <div className="hero-copy">
            <h2>Scout a location before you make your move.</h2>
            <p>Enter a location and let us scout it out.</p>
          </div>
          <svg className="hero-contours" aria-hidden="true" viewBox="0 0 260 220" focusable="false">
            <path d="M231 13c-38 4-72 16-101 37-28 20-46 43-83 49-21 4-37 1-56-5" />
            <path d="M251 62c-36 7-66 20-91 39-32 24-50 53-95 57-25 2-43-5-65-18" />
            <path d="M243 118c-27 2-50 11-70 26-24 18-39 41-73 48-24 5-50 0-76-16" />
            <path d="M202 11c-16 23-23 45-20 66 4 28 24 49 21 82-2 19-11 34-27 48" />
          </svg>
          <form className="search-card" onSubmit={handleSubmit}>
            <div className="search-card-heading"><span>Location search</span></div>
            <div className="search-row">
              <div className="search-input-wrap">
                <input
                  id="suburb-query"
                  placeholder="Hobart"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setCanonicalPlace(null); fetchSuggestions(e.target.value) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => { setQuery(''); setSuggestions([]); setShowSuggestions(false) }}
                  autoComplete="off"
                  disabled={isLoading}
                />
                {showSuggestions && suggestions.length > 0 && (
                  <ul className="suggestions-list" role="listbox" aria-label="Location suggestions">
                    {suggestions.map((s) => (
                      <li
                        key={`${s.name}-${s.state}`}
                        role="option"
                        aria-selected={false}
                        className="suggestions-item"
                        onMouseDown={(e) => {
                          e.preventDefault()
                          setSuggestions([])
                          setShowSuggestions(false)
                          setCanonicalPlace(s.name)
                          void runSearch(s.name, s.state)
                        }}
                      >
                        <span className="suggestions-name">{s.name}</span>
                        <span className="suggestions-meta">{s.state}{s.postcode ? ` · ${s.postcode}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                type="submit"
                className={isLoading ? 'is-loading' : undefined}
                disabled={isLoading || !query.trim()}
                aria-label={isLoading ? 'Scouting location' : undefined}
              >
                {isLoading ? <span className="button-spinner" aria-label="Scouting" /> : 'Scout'}
              </button>
            </div>
            {quickLocationTags.length > 0 && (
              <>
                <div className="compare-toggle-row">
                  <label className="compare-toggle-label">
                    <span className="ios-toggle">
                      <input
                        type="checkbox"
                        checked={compareMode}
                        onChange={(e) => {
                          const on = e.target.checked
                          setCompareMode(on)
                          if (!on) {
                            setCompareKeys([])
                          } else {
                            // Auto-select current location if cached
                            const currentKey = composedQuery.trim().toLowerCase()
                            if (currentKey && getCachedReview(currentKey) !== null) {
                              setCompareKeys([currentKey])
                            }
                          }
                        }}
                      />
                      <span className="ios-toggle-track" aria-hidden="true" />
                    </span>
                    <span>Compare</span>
                  </label>
                  {compareMode && compareKeys.length > 0 && (
                    <span className="compare-count-badge">
                      {compareKeys.length}/6
                    </span>
                  )}
                </div>

                {compareMode ? (
                  <div className="quick-location-grid compare-select-grid" aria-label="Select locations to compare">
                    {compareLocationTags.map((search) => {
                      const key = search.trim().toLowerCase()
                      const isSelected = compareKeys.includes(key)
                      const isDisabled = !isSelected && compareKeys.length >= 6
                      return (
                        <button
                          key={search}
                          type="button"
                          className={`quick-location-tag quick-location-tag--compare${isSelected ? ' selected' : ''}${isDisabled ? ' disabled' : ''}`}
                          disabled={isDisabled}
                          aria-pressed={isSelected}
                          onClick={() =>
                            setCompareKeys((prev) =>
                              prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
                            )
                          }
                        >
                          <LocationPinIcon />
                          <span>{search}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                <div className="quick-location-grid" aria-label="Quick location selections">
                  {quickLocationTags.map((search) => {
                    const key = search.trim().toLowerCase()
                    const isCached = getCachedReview(key) !== null
                    const isRecent = recentSearches.some((s) => s.trim().toLowerCase() === key) || isCached
                    return (
                      <div key={search} className={`quick-location-tag-wrap${isRecent ? ' is-recent' : ''}`}>
                        <a
                          className="quick-location-tag"
                          href={toSearchHref(search, selectedState)}
                          onClick={(e) => {
                            e.preventDefault()
                            setSuggestions([])
                            setShowSuggestions(false)
                            const parsed = splitLocation(search)
                            if (!parsed.place) return
                            void runSearch(parsed.place, parsed.state ?? selectedState)
                          }}
                        >
                          <LocationPinIcon />
                          <span>{search}</span>
                        </a>
                        {isRecent && (
                          <button
                            type="button"
                            className="quick-location-remove"
                            aria-label={`Remove ${search}`}
                            onMouseDown={(e) => {
                              e.preventDefault()
                              removeLocation(search)
                            }}
                          >
                            <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                              <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
                            </svg>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                )}
              </>
            )}
          </form>
        </section>
      )}

      {compareMode && compareReviews.length > 0 && (
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
          <div><h2>Scouting {composedQuery ? `${composedQuery}` : 'location'}…</h2></div>
        </section>
      )}

      {error && <div className="error-card">{error}</div>}

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
          </div>

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
                      onCategoryClick={(key) => setActiveTab(key as ReviewSectionKey)}
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
                    <button type="button" className="summary-download primary-lite" onClick={downloadPdf} disabled={isExporting}>
                      {isExporting ? 'Preparing PDF...' : 'Download PDF'}
                    </button>
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

                {activeTab === 'property' && <PropertyTab review={review} />}
                {activeTab === 'environment' && <EnvironmentTab review={review} />}
                {activeTab === 'crime' && <CrimeTab review={review} />}
                {activeTab === 'infrastructure' && <InfrastructureTab review={review} />}
                {activeTab === 'demographics' && <DemographicsTab review={review} />}
                {activeTab === 'map' && <MapTab review={review} />}
              </>
            )}

            {!locationNotFound && review.caveats?.length > 0 && (
              <section className="caveats">
                <h3>Caveats</h3>
                <ul>
                  {review.caveats.map((caveat) => (
                    <li key={caveat}>{caveat}</li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        </section>
      )}

    </main>
  )
}

export default App

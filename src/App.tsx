import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import './App.css'

import type { AustralianState, LlmSettings, Review, ReviewSectionKey, SuburbSuggestion } from './types'
import {
  STORAGE_KEY, MAX_RECENT_SEARCHES,
  clearReviewCache, getCachedReview, getReviewCacheCount, setCachedReview,
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
import { PropertyIcon, SafetyIcon, InfrastructureIcon, DemographicsIcon, EnvironmentIcon, MapIcon } from './components/TabIcons'

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
  { key: 'demographics', label: 'Demographics' },
  { key: 'environment', label: 'Environment' },
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
  const [cacheActionMessage, setCacheActionMessage] = useState('')
  const [showReferences, setShowReferences] = useState(false)
  const [suggestions, setSuggestions] = useState<SuburbSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestionsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSearchStartedRef = useRef(false)
  const reviewRef = useRef<HTMLElement | null>(null)

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

    return [
      ...uniqueRecentSearches,
      ...featuredQuickLocations.filter((s) => !seen.has(s.toLowerCase())),
    ].slice(0, featuredQuickLocations.length)
  }, [recentSearches])

  const composedQuery = query.trim() ? `${query.trim()}, ${selectedState}` : ''
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
    async (place: string, state: AustralianState, options: { updateQueryString?: boolean } = {}) => {
      const trimmedPlace = place.trim()
      const trimmedQuery = trimmedPlace ? `${trimmedPlace}, ${state}` : ''
      if (!trimmedQuery) return

      setQuery(trimmedPlace)
      setSelectedState(state)

      if (options.updateQueryString !== false) writeSearchToQueryString(trimmedPlace, state)

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
        setActiveTab('property')
        setShowReferences(false)
        return
      }

      setIsLoading(true)
      setError('')
      setShowReferences(false)
      setReview(null)
      setActiveTab('property')
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
        }
      } catch (caught) {
        setError(friendlyRequestError(caught))
      } finally {
        setIsLoading(false)
      }
    },
    [providerReady, rememberSearch, settings],
  )

  useEffect(() => {
    if (autoSearchStartedRef.current) return
    const initialSearch = readSearchFromQueryString()
    if (!initialSearch?.place) return
    const initialState = initialSearch.state ?? selectedState
    autoSearchStartedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void runSearch(initialSearch.place, initialState)
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
      document.title = `Scouter - ${review.suburb}, ${review.state} Review`
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

  const clearCurrentLocation = useCallback(() => {
    setQuery('')
    setReview(null)
    setHasSearched(false)
    setIsSearchOpen(true)
    setActiveTab('property')
    setError('')
    setShowReferences(false)
    setSuggestions([])
    setShowSuggestions(false)
    setCacheActionMessage('')
    clearSearchFromUrl()
  }, [clearSearchFromUrl])

  const clearCacheAndRecentSearches = useCallback(() => {
    clearReviewCache()
    saveRecentSearches([])
    setRecentSearches([])
    setCacheLocationCount(0)
    clearCurrentLocation()
    setCacheActionMessage('Cache cleared.')
    setSaveStatus('Cache cleared')
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

      const ensureSpace = (height: number) => {
        if (y + height > pageHeight - margin) { pdf.addPage(); y = margin }
      }

      const write = (text: string, size = 10, style: 'normal' | 'bold' = 'normal', gap = 5) => {
        pdf.setFont('helvetica', style)
        pdf.setFontSize(size)
        const lines = pdf.splitTextToSize(text, maxWidth) as string[]
        const height = lines.length * (size * 0.42) + gap
        ensureSpace(height)
        pdf.text(lines, margin, y)
        y += height
      }

      const section = (heading: string, body: string) => {
        y += 2
        write(heading, 13, 'bold', 4)
        write(body, 10, 'normal', 7)
      }

      pdf.setFillColor(248, 251, 244)
      pdf.rect(0, 0, pageWidth, pageHeight, 'F')
      write(`${review.suburb}, ${review.state} Profile`, 20, 'bold', 7)
      write(review.summary, 11, 'normal', 8)

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

      section('Safety & Insurance', [
        review.crime.narrative,
        review.crime.insuranceImpact ? `\nInsurance impact: ${review.crime.insuranceImpact}` : '',
        review.crime.estimatedAnnualPremiums
          ? `\nEstimated annual premiums:\n${Object.entries(review.crime.estimatedAnnualPremiums).map(([k, v]) => `  ${k}: ${v}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n\n'))

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
          review.demographics.householdTypes?.length ? `Household types: ${review.demographics.householdTypes.map((i) => `${i.label} ${i.value}%`).join(', ')}` : '',
          review.demographics.countryOfOrigin?.length ? `Country of origin: ${review.demographics.countryOfOrigin.map((i) => `${i.label} ${i.value}%`).join(', ')}` : '',
        ].filter(Boolean).join('\n\n'))
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

  return (
    <main className="app-shell">
      <header className={isSticky ? 'topbar is-sticky' : 'topbar'}>
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
            onClick={() => setIsSearchOpen(true)}
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
              : <span className="topbar-search-pill-action">{review && !locationNotFound ? 'Scout again' : 'Change'}</span>
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
              cacheLocationCount={cacheLocationCount}
              cacheActionMessage={cacheActionMessage}
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
            <span className="pill">Property, climate, crime, logistics</span>
            <h2>Scout a location before you make your move.</h2>
            <p>Enter a location and state and let us scout it out.</p>
          </div>
          <svg className="hero-contours" aria-hidden="true" viewBox="0 0 260 220" focusable="false">
            <path d="M231 13c-38 4-72 16-101 37-28 20-46 43-83 49-21 4-37 1-56-5" />
            <path d="M251 62c-36 7-66 20-91 39-32 24-50 53-95 57-25 2-43-5-65-18" />
            <path d="M243 118c-27 2-50 11-70 26-24 18-39 41-73 48-24 5-50 0-76-16" />
            <path d="M202 11c-16 23-23 45-20 66 4 28 24 49 21 82-2 19-11 34-27 48" />
          </svg>
          <form className="search-card" onSubmit={handleSubmit}>
            <div className="search-card-heading"><span>Suburb search</span></div>
            <label htmlFor="suburb-query">Location</label>
            <div className="search-input-wrap">
              <div className="search-row">
                <input
                  id="suburb-query"
                  placeholder="Hobart"
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); fetchSuggestions(e.target.value) }}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  onFocus={() => { setQuery(''); setSuggestions([]); setShowSuggestions(false) }}
                  autoComplete="off"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  className={isLoading ? 'is-loading' : undefined}
                  disabled={isLoading || !query.trim()}
                  aria-label={isLoading ? 'Scouting location' : undefined}
                >
                  {isLoading ? <span className="button-spinner" aria-label="Scouting" /> : 'Scout'}
                </button>
              </div>
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
            {quickLocationTags.length > 0 && (
              <div className="quick-location-grid" aria-label="Quick location selections">
                {quickLocationTags.map((search) => (
                  <a
                    key={search}
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
                ))}
              </div>
            )}
          </form>
        </section>
      )}

      {isLoading && (
        <section className="busy-card" aria-live="polite">
          <div className="spinner" />
          <div><h2>Scouting location...</h2></div>
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
                      setIsSearchOpen(true)
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
                      aria-label={tab.key === 'map' ? 'Map' : undefined}
                      title={tab.key === 'map' ? 'Map' : undefined}
                    >
                      {tab.key === 'map' ? <MapIcon /> : <>{TAB_ICONS[tab.key]}{tab.label}</>}
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

      {!review && !isLoading && (
        <section className="empty-state">
          <div><h2>Make a smarter move with a clearer view.</h2></div>
        </section>
      )}

      <footer className="site-footer">
        <p>© {new Date().getFullYear()} Michael Soutar</p>
      </footer>
    </main>
  )
}

export default App

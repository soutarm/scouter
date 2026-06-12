import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import './App.css'

type ProviderKind = 'azure' | 'openai'

type LlmSettings = {
  provider: ProviderKind
  azureEndpoint: string
  azureDeployment: string
  azureApiKey: string
  azureApiVersion: string
  openAiBaseUrl: string
  openAiModel: string
  openAiApiKey: string
}

type ReviewSectionKey = 'property' | 'climate' | 'crime' | 'infrastructure' | 'map'

type MarketRow = {
  propertyType: string
  medianPrice: string
  twelveMonthGrowth: string
  medianWeeklyRent: string
  grossYield: string
}

type Review = {
  exists?: boolean
  suburb: string
  state: string
  generatedAt: string
  summary: string
  notFoundReason?: string
  suggestedSuburb?: string
  suggestedState?: string
  marketNarrative: string
  marketRows: MarketRow[]
  climate: {
    summerAverages: string
    winterAverages: string
  }
  crime: string
  infrastructure: {
    transit: string
    education: string
    lifestyle: string
    demographic: string
  }
  caveats: string[]
  references?: string[]
}

const STORAGE_KEY = 'scouter.llm-settings'
const RECENT_SEARCHES_KEY = 'scouter.recent-searches'
const REQUEST_TIMEOUT_MS = 60_000
const MAX_RECENT_SEARCHES = 12

const defaultSettings: LlmSettings = {
  provider: 'azure',
  azureEndpoint: '',
  azureDeployment: '',
  azureApiKey: '',
  azureApiVersion: '2025-04-01-preview',
  openAiBaseUrl: 'https://api.openai.com/v1',
  openAiModel: '',
  openAiApiKey: '',
}

const australianStates = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const
type AustralianState = (typeof australianStates)[number]

const featuredQuickLocations = [
  'Canberra, ACT',
  'Sydney, NSW',
  'Darwin, NT',
  'Brisbane, QLD',
  'Adelaide, SA',
  'Hobart, TAS',
  'Melbourne, VIC',
  'Perth, WA',
] as const

const splitLocation = (value: string) => {
  const trimmed = value.trim()
  const match = trimmed.match(/^(.*?),\s*(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/i)
  if (!match) return { place: trimmed, state: undefined }

  return {
    place: (match[1] ?? '').trim(),
    state: (match[2] ?? '').toUpperCase() as AustralianState,
  }
}

const isAustralianState = (value: string | null | undefined): value is AustralianState =>
  australianStates.includes((value ?? '').toUpperCase() as AustralianState)

const readSearchFromQueryString = () => {
  const params = new URLSearchParams(window.location.search)
  const rawSearch = (params.get('search') ?? '').trim()
  const rawState = params.get('state')
  if (!rawSearch) return null

  const parsed = splitLocation(rawSearch)
  return {
    place: parsed.place,
    state: isAustralianState(rawState) ? rawState.toUpperCase() as AustralianState : parsed.state,
  }
}

const writeSearchToQueryString = (place: string, state: AustralianState) => {
  const params = new URLSearchParams(window.location.search)
  params.set('search', place)
  params.set('state', state)

  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}?${params.toString()}${window.location.hash}`,
  )
}

const toSearchHref = (search: string, fallbackState: AustralianState) => {
  const parsed = splitLocation(search)
  const state = parsed.state ?? fallbackState
  const params = new URLSearchParams(window.location.search)
  params.set('search', parsed.place)
  params.set('state', state)

  return `${window.location.pathname}?${params.toString()}${window.location.hash}`
}

const getSuggestedLocation = (review: Review | null) => {
  const suggestedSuburb = review?.suggestedSuburb?.trim()
  const suggestedState = review?.suggestedState?.trim().toUpperCase()

  if (!suggestedSuburb || !isAustralianState(suggestedState)) return null

  return {
    place: suggestedSuburb,
    state: suggestedState,
    label: `${suggestedSuburb}, ${suggestedState}`,
  }
}

const toMapQuery = (review: Review) => `${review.suburb}, ${review.state}, Australia`

const toGoogleMapsEmbedUrl = (review: Review) =>
  `https://www.google.com/maps?q=${encodeURIComponent(toMapQuery(review))}&output=embed`

const toGoogleMapsUrl = (review: Review) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toMapQuery(review))}`

const CLIMATE_SCALE_MIN = -10
const CLIMATE_SCALE_MAX = 50

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const formatTemperature = (value: number) => `${Math.round(value)}°C`

const extractTemperatureRange = (description: string) => {
  const temperatures: number[] = []
  let textWithoutRanges = description

  textWithoutRanges = textWithoutRanges.replace(
    /(^|[^\d.])(-?\d+(?:\.\d+)?)\s*(?:°\s*)?(?:c\b)?\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b/gi,
    (match, prefix: string, low: string, high: string) => {
      temperatures.push(Number.parseFloat(low), Number.parseFloat(high))
      return prefix.padEnd(match.length, ' ')
    },
  )

  temperatures.push(
    ...[...textWithoutRanges.matchAll(/(^|[^\d.])(-?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b/gi)].map((match) =>
      Number.parseFloat(match[2]),
    ),
  )

  if (!temperatures.length) return null

  return {
    min: Math.min(...temperatures),
    max: Math.max(...temperatures),
  }
}

const temperaturePosition = (value: number) =>
  ((clampNumber(value, CLIMATE_SCALE_MIN, CLIMATE_SCALE_MAX) - CLIMATE_SCALE_MIN) /
    (CLIMATE_SCALE_MAX - CLIMATE_SCALE_MIN)) *
  100

const tabs: Array<{ key: ReviewSectionKey; label: string }> = [
  { key: 'property', label: 'Property' },
  { key: 'climate', label: 'Climate' },
  { key: 'crime', label: 'Crime' },
  { key: 'infrastructure', label: 'Infrastructure' },
  { key: 'map', label: 'Map' },
]

const loadSettings = (): LlmSettings => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings
  } catch {
    return defaultSettings
  }
}

const saveSettings = (settings: LlmSettings) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

const loadRecentSearches = () => {
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

const saveRecentSearches = (searches: string[]) => {
  window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches))
}

const stripJsonFence = (value: string) =>
  value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

const parseReferenceLink = (reference: string) => {
  const trimmed = reference.trim()
  const markdownLink = trimmed.match(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/i)

  if (markdownLink) {
    return {
      label: markdownLink[1].trim(),
      url: markdownLink[2].trim(),
    }
  }

  const urlMatch = trimmed.match(/https?:\/\/[^\s)\]]+/i)

  if (!urlMatch) {
    return { label: trimmed, url: '' }
  }

  const url = urlMatch[0].replace(/[.,;:]+$/, '')
  const label = trimmed.replace(urlMatch[0], '').replace(/[\s,;:-]+$/, '').trim()

  return {
    label: label || url,
    url,
  }
}

const buildPrompt = (query: string) => `You are an Australian suburb research analyst.

Create a concise but useful suburb review for: ${query}.

If you cannot confidently identify the Australian location, return "exists": false, use the requested place/state in "suburb" and "state", explain the issue in "summary" and "notFoundReason", and return empty or brief placeholder values for the remaining fields. If there is a likely intended Australian suburb or town, include it in "suggestedSuburb" and include its Australian state or territory abbreviation in "suggestedState". For example, if the request is "Warragul, TAS", explain that it appears to correspond to Warragul, VIC, and set "suggestedSuburb": "Warragul" and "suggestedState": "VIC".

Return JSON only. Do not include markdown fences. Use current 2026 context where possible. Use AUD for money. Do not use em dashes.

JSON shape:
{
  "exists": true,
  "suburb": "Suburb name",
  "state": "State abbreviation",
  "generatedAt": "ISO timestamp",
  "summary": "Top-level practical assessment in 2-4 sentences.",
  "notFoundReason": "Only present when exists is false.",
  "suggestedSuburb": "Likely intended suburb or town. Only present when exists is false and a likely correction exists.",
  "suggestedState": "Likely intended Australian state or territory abbreviation. Only present when exists is false and a likely correction exists.",
  "marketNarrative": "Short market conditions paragraph.",
  "marketRows": [
    { "propertyType": "Houses", "medianPrice": "AUD $...", "twelveMonthGrowth": "+...%", "medianWeeklyRent": "AUD $...", "grossYield": "...%" },
    { "propertyType": "Units / Townhouses", "medianPrice": "AUD $...", "twelveMonthGrowth": "...%", "medianWeeklyRent": "AUD $...", "grossYield": "...%" }
  ],
  "climate": {
    "summerAverages": "Average high and low temperatures plus seasonal behaviour.",
    "winterAverages": "Average high and low temperatures plus rainfall/cloud/frost behaviour."
  },
  "crime": "Crime and safety analysis with LGA, common incident types, and practical safety interpretation.",
  "infrastructure": {
    "transit": "Train, bus, road and commute context.",
    "education": "Primary, secondary, tertiary and catchment notes.",
    "lifestyle": "Retail, dining, parks, health, culture and daily amenity.",
    "demographic": "Dominant resident profiles and census-style context."
  },
  "caveats": ["Any uncertainty, unavailable fresh data, or source limitation."],
  "references": ["Named data source, publication, or public agency used or recommended for verification, including a URL when available."]
}`

const extractAzureResponseText = (payload: {
  output_text?: string
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
}) =>
  payload.output_text ??
  payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text' || item.type === 'text')?.text

const friendlyRequestError = (caught: unknown) => {
  if (caught instanceof DOMException && caught.name === 'AbortError') {
    return 'The LLM request timed out after 60 seconds. Try a smaller/faster model or run the query again.'
  }

  if (caught instanceof TypeError && /fetch|network|failed/i.test(caught.message)) {
    return 'The browser could not reach the LLM provider. This is usually CORS or network blocking. Pulse avoids this with a server route, but GitHub Pages is static, so direct browser calls only work with providers that allow browser CORS requests.'
  }

  return caught instanceof Error ? caught.message : 'Review generation failed.'
}

const parseReview = (content: string): Review => {
  const parsed = JSON.parse(stripJsonFence(content)) as Review
  if (parsed.exists === false && parsed.summary) {
    return parsed
  }

  if (!parsed.summary || !Array.isArray(parsed.marketRows) || !parsed.infrastructure) {
    throw new Error('The model returned JSON, but not the expected review shape.')
  }
  return parsed
}

const callLlm = async (settings: LlmSettings, query: string): Promise<Review> => {
  const prompt = buildPrompt(query)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    if (settings.provider === 'azure') {
      if (!settings.azureEndpoint || !settings.azureDeployment || !settings.azureApiKey) {
        throw new Error('Azure endpoint, deployment and API key are required.')
      }

      const response = await fetch(
        `${settings.azureEndpoint.replace(/\/$/, '')}/openai/responses?api-version=${settings.azureApiVersion || defaultSettings.azureApiVersion}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': settings.azureApiKey,
          },
          body: JSON.stringify({
            model: settings.azureDeployment,
            input: [{ role: 'user', content: prompt }],
            text: { format: { type: 'json_object' }, verbosity: 'low' },
            reasoning: { effort: 'low' },
            max_output_tokens: 2600,
          }),
          signal: controller.signal,
        },
      )

      const rawPayload = await response.text()
      if (!response.ok) {
        throw new Error(`Azure request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
      }

      const payload = JSON.parse(rawPayload) as {
        output_text?: string
        output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
      }
      const content = extractAzureResponseText(payload)

      if (!content) throw new Error('Azure returned no review content.')
      return parseReview(content)
    }

    if (!settings.openAiApiKey || !settings.openAiModel) {
      throw new Error('OpenAI-compatible API key and model are required.')
    }

    const response = await fetch(`${settings.openAiBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.openAiApiKey}`,
      },
      body: JSON.stringify({
        model: settings.openAiModel,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 2600,
      }),
      signal: controller.signal,
    })

    const rawPayload = await response.text()
    if (!response.ok) {
      throw new Error(`OpenAI-compatible request failed: ${response.status} ${rawPayload.slice(0, 260)}`)
    }

    const payload = JSON.parse(rawPayload) as { choices?: Array<{ message?: { content?: string } }> }
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('Provider returned no review content.')
    return parseReview(content)
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const ScouterMark = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 74 74" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g transform="rotate(-6 37 37)">
      <path className="brand-mark-road brand-mark-road-light" d="M57 13C52 4 28 6 24 17C20 27 32 30 42 32C58 36 62 48 50 58C40 66 24 62 20 51" />
      <path className="brand-mark-road brand-mark-road-mid" d="M58 21C53 12 31 14 26 25C23 34 35 38 44 40C60 44 64 55 51 65C42 72 27 68 22 58" />
      <path className="brand-mark-road brand-mark-road-dark" d="M59 29C54 20 34 22 29 32C26 41 38 45 47 47C61 51 64 61 52 69C44 74 31 72 25 65" />
    </g>
  </svg>
)

const ThermometerRange = ({ label, description }: { label: string; description: string }) => {
  const range = extractTemperatureRange(description)

  if (!range) {
    return (
      <div className="thermometer-card">
        <p className="thermometer-label">{label}</p>
        <p className="thermometer-empty">Temperature range unavailable</p>
      </div>
    )
  }

  const minPosition = temperaturePosition(range.min)
  const maxPosition = temperaturePosition(range.max)

  return (
    <div className="thermometer-card" aria-label={`${label} temperature range`}>
      <div className="thermometer-header">
        <p className="thermometer-label">{label}</p>
        <p>
          <span>{formatTemperature(range.min)}</span>
          <span>{formatTemperature(range.max)}</span>
        </p>
      </div>
      <div className="thermometer-track" aria-hidden="true">
        <span className="thermometer-fill" style={{ left: `${minPosition}%`, width: `${Math.max(maxPosition - minPosition, 2)}%` }} />
        <span className="thermometer-marker min" style={{ left: `${minPosition}%` }} />
        <span className="thermometer-marker max" style={{ left: `${maxPosition}%` }} />
      </div>
      <div className="thermometer-scale" aria-hidden="true">
        <span>{formatTemperature(CLIMATE_SCALE_MIN)}</span>
        <span>{formatTemperature(CLIMATE_SCALE_MAX)}</span>
      </div>
    </div>
  )
}

const LocationPinIcon = () => (
  <svg className="location-pin" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <path d="M12 21s6.3-5.6 6.3-11.1A6.3 6.3 0 0 0 5.7 9.9C5.7 15.4 12 21 12 21Z" />
    <circle cx="12" cy="9.9" r="2.15" />
  </svg>
)

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
  const [fallbackPrompt, setFallbackPrompt] = useState('')
  const [showReferences, setShowReferences] = useState(false)
  const autoSearchStartedRef = useRef(false)

  const providerReady = useMemo(() => {
    if (settings.provider === 'azure') {
      return Boolean(settings.azureEndpoint && settings.azureDeployment && settings.azureApiKey)
    }
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

    if (uniqueRecentSearches.length >= featuredQuickLocations.length) {
      return uniqueRecentSearches
    }

    return [
      ...uniqueRecentSearches,
      ...featuredQuickLocations.filter((search) => !seen.has(search.toLowerCase())),
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

  const runSearch = useCallback(
    async (place: string, state: AustralianState, options: { updateQueryString?: boolean } = {}) => {
      const trimmedPlace = place.trim()
      const trimmedQuery = trimmedPlace ? `${trimmedPlace}, ${state}` : ''
      if (!trimmedQuery) return

      setQuery(trimmedPlace)
      setSelectedState(state)

      if (options.updateQueryString !== false) {
        writeSearchToQueryString(trimmedPlace, state)
      }

      if (!providerReady) {
        setShowSettings(true)
        setError('Add LLM settings before running a review.')
        return
      }

      setIsLoading(true)
      setError('')
      setFallbackPrompt('')
      setShowReferences(false)
      setReview(null)
      setActiveTab('property')
      setHasSearched(true)
      setIsSearchOpen(false)
      try {
        const result = await callLlm(settings, trimmedQuery)
        const nextReview = { ...result, generatedAt: result.generatedAt || new Date().toISOString() }
        setReview(nextReview)
        if (nextReview.exists !== false) {
          rememberSearch(trimmedQuery)
        }
      } catch (caught) {
        setError(friendlyRequestError(caught))
        setFallbackPrompt(buildPrompt(trimmedQuery))
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
    void runSearch(initialSearch.place, initialState)
  }, [runSearch, selectedState])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedQuery = splitLocation(query)
    const place = parsedQuery.place
    const state = parsedQuery.state ?? selectedState
    const trimmedQuery = place ? `${place}, ${state}` : ''
    if (!trimmedQuery) return
    await runSearch(place, state)
  }

  const copyPrompt = async () => {
    if (!fallbackPrompt) return
    await navigator.clipboard.writeText(fallbackPrompt)
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
        if (y + height > pageHeight - margin) {
          pdf.addPage()
          y = margin
        }
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
        write(
          `${row.propertyType}: ${row.medianPrice}, ${row.twelveMonthGrowth} growth, ${row.medianWeeklyRent} rent, ${row.grossYield} yield`,
          9,
          'normal',
          3,
        )
      })

      section('Climate & Weather Profile', `Summer: ${review.climate.summerAverages}\n\nWinter: ${review.climate.winterAverages}`)
      section('Crime & Safety Analysis', review.crime)
      section(
        'Infrastructure, Education & Logistics',
        `Transit & Commute: ${review.infrastructure.transit}\n\nEducation & Catchments: ${review.infrastructure.education}\n\nLifestyle & Amenities: ${review.infrastructure.lifestyle}\n\nDemographic Vibe: ${review.infrastructure.demographic}`,
      )

      if (review.caveats?.length) {
        section('Caveats', review.caveats.map((caveat) => `- ${caveat}`).join('\n'))
      }

      if (review.references?.length) {
        section('References', review.references.map((reference) => `- ${reference}`).join('\n'))
      }

      const fileName = `${review.suburb || 'suburb'}-${review.state || 'review'}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      pdf.save(`${fileName}.pdf`)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'PDF export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <ScouterMark className="brand-mark" />
          <div className="brand-copy">
            <h1 className="brand-wordmark" aria-label="Scouter">
              <span className="brand-letter brand-letter-s" aria-hidden="true">S</span>
              <span className="brand-letter" aria-hidden="true">C</span>
              <span className="brand-letter" aria-hidden="true">O</span>
              <span className="brand-letter" aria-hidden="true">U</span>
              <span className="brand-letter" aria-hidden="true">T</span>
              <span className="brand-letter" aria-hidden="true">E</span>
              <span className="brand-letter brand-letter-r" aria-hidden="true">R</span>
            </h1>
          </div>
        </div>
        <button
          className="settings-button"
          type="button"
          onClick={() => setShowSettings((open) => !open)}
          aria-label="LLM settings"
          aria-expanded={showSettings}
          title="LLM settings"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
            <path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.5 2 1.5A8.9 8.9 0 0 0 4.5 12c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z" />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
        </button>
      </header>

      {showSettings && (
        <section className="settings-card" aria-label="LLM settings">
          <div className="settings-header">
            <div>
              <h2>Provider settings</h2>
              <p>Stored locally in this browser. Do not use public/shared API keys.</p>
            </div>
            <div className="settings-controls">
              <span className={providerReady ? 'status-pill ready' : 'status-pill'}>
                {providerReady ? `Ready, ${saveStatus}` : saveStatus}
              </span>
              <select
                value={settings.provider}
                onChange={(event) => updateSettings({ ...settings, provider: event.target.value as ProviderKind })}
              >
                <option value="azure">Azure OpenAI</option>
                <option value="openai">OpenAI compatible</option>
              </select>
            </div>
          </div>

          {settings.provider === 'azure' ? (
            <div className="settings-grid">
              <label>
                Endpoint
                <input
                  placeholder="https://example.openai.azure.com"
                  value={settings.azureEndpoint}
                  onChange={(event) => updateSettings({ ...settings, azureEndpoint: event.target.value })}
                />
              </label>
              <label>
                Deployment
                <input
                  placeholder="gpt-5.4-mini"
                  value={settings.azureDeployment}
                  onChange={(event) => updateSettings({ ...settings, azureDeployment: event.target.value })}
                />
              </label>
              <label>
                API version
                <input
                  value={settings.azureApiVersion}
                  onChange={(event) => updateSettings({ ...settings, azureApiVersion: event.target.value })}
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={settings.azureApiKey}
                  onChange={(event) => updateSettings({ ...settings, azureApiKey: event.target.value })}
                />
              </label>
            </div>
          ) : (
            <div className="settings-grid">
              <label>
                Base URL
                <input
                  value={settings.openAiBaseUrl}
                  onChange={(event) => updateSettings({ ...settings, openAiBaseUrl: event.target.value })}
                />
              </label>
              <label>
                Model
                <input
                  placeholder="gpt-4.1-mini"
                  value={settings.openAiModel}
                  onChange={(event) => updateSettings({ ...settings, openAiModel: event.target.value })}
                />
              </label>
              <label>
                API key
                <input
                  type="password"
                  value={settings.openAiApiKey}
                  onChange={(event) => updateSettings({ ...settings, openAiApiKey: event.target.value })}
                />
              </label>
            </div>
          )}
        </section>
      )}

      <section className={hasSearched && !isSearchOpen ? 'hero-panel collapsed' : 'hero-panel'}>
        {hasSearched && !isSearchOpen ? (
          <button
            className="search-accordion-button"
            type="button"
            onClick={() => setIsSearchOpen(true)}
            aria-expanded={isSearchOpen}
          >
            <span>
              <span className="eyebrow">Suburb search</span>
              <strong>{composedQuery || 'Search another suburb'}</strong>
            </span>
            <span>{isLoading ? 'Reviewing...' : 'Change search'}</span>
          </button>
        ) : (
          <>
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
              <div className="search-card-heading">
                <span>Suburb search</span>
              </div>
              <label htmlFor="suburb-query">Location</label>
              <div className="search-row">
                <input
                  id="suburb-query"
                  placeholder="Hobart"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={isLoading}
                />
                <select
                  aria-label="State or territory"
                  value={selectedState}
                  onChange={(event) => setSelectedState(event.target.value as AustralianState)}
                  disabled={isLoading}
                >
                  {australianStates.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={isLoading || !query.trim()}>
                  {isLoading ? <span className="button-spinner" aria-label="Scouting" /> : 'Scout'}
                </button>
              </div>
              {quickLocationTags.length > 0 && (
                <div className="quick-location-grid" aria-label="Quick location selections">
                  {quickLocationTags.map((search) => (
                    <a
                      key={search}
                      className="quick-location-tag"
                      href={toSearchHref(search, selectedState)}
                      onClick={(event) => {
                        event.preventDefault()
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
          </>
        )}
      </section>

      {isLoading && (
        <section className="busy-card" aria-live="polite">
          <div className="spinner" />
          <div>
            <h2>Scouting location...</h2>
          </div>
        </section>
      )}

      {error && <div className="error-card">{error}</div>}

      {fallbackPrompt && !isLoading && (
        <section className="fallback-card">
          <div>
            <h2>Provider call did not complete</h2>
            <p>
              You can copy the exact prompt and run it in your LLM console while we decide whether to add a
              small proxy for GitHub Pages.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={copyPrompt}>
            Copy prompt
          </button>
        </section>
      )}

      {review && (
        <section className="review-wrap">
          <div className={showReferences ? 'references-drawer open' : 'references-drawer'}>
            <button
              type="button"
              className="references-tab"
              onClick={() => setShowReferences((visible) => !visible)}
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
                  {review.references.map((reference) => (
                    <li key={reference}>
                      {(() => {
                        const parsed = parseReferenceLink(reference)
                        return parsed.url ? (
                          <a href={parsed.url} target="_blank" rel="noreferrer">
                            {parsed.label}
                          </a>
                        ) : (
                          parsed.label
                        )
                      })()}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="references-empty">
                  No references are available for this review yet.
                </p>
              )}
            </section>
          </div>

          <div className="review-actions">
            <div>
              <p className="eyebrow">Generated review</p>
              <h2>
                {review.suburb}, {review.state}
              </h2>
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
                      if (suggestedLocation) {
                        void runSearch(suggestedLocation.place, suggestedLocation.state)
                        return
                      }

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
                  <div>
                    <p className="eyebrow">Summary</p>
                    <h2>
                      {review.suburb}, {review.state} Profile
                    </h2>
                  </div>
                  <p>{review.summary}</p>
                  <button type="button" className="summary-download primary-lite" onClick={downloadPdf} disabled={isExporting}>
                    {isExporting ? 'Preparing PDF...' : 'Download PDF'}
                  </button>
                </section>

                <nav className="tabs" aria-label="Review sections">
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      className={activeTab === tab.key ? 'active' : ''}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </nav>

                {activeTab === 'property' && (
                  <section className="tab-panel">
                    <h3>Property Market & Rental Realities</h3>
                    <p>{review.marketNarrative}</p>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Property Type</th>
                            <th>Median Price</th>
                            <th>12-Month Growth</th>
                            <th>Median Weekly Rent</th>
                            <th>Gross Yield</th>
                          </tr>
                        </thead>
                        <tbody>
                          {review.marketRows.map((row) => (
                            <tr key={row.propertyType}>
                              <td>{row.propertyType}</td>
                              <td>{row.medianPrice}</td>
                              <td>{row.twelveMonthGrowth}</td>
                              <td>{row.medianWeeklyRent}</td>
                              <td>{row.grossYield}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {activeTab === 'climate' && (
                  <section className="tab-panel climate-panel">
                    <div className="climate-card">
                      <h3>Summer Averages</h3>
                      <ThermometerRange label="Summer min / max" description={review.climate.summerAverages} />
                      <p>{review.climate.summerAverages}</p>
                    </div>
                    <div className="climate-card">
                      <h3>Winter Averages</h3>
                      <ThermometerRange label="Winter min / max" description={review.climate.winterAverages} />
                      <p>{review.climate.winterAverages}</p>
                    </div>
                  </section>
                )}

                {activeTab === 'crime' && (
                  <section className="tab-panel">
                    <h3>Crime & Safety Analysis</h3>
                    <p>{review.crime}</p>
                  </section>
                )}

                {activeTab === 'infrastructure' && (
                  <section className="tab-panel feature-grid">
                    <div>
                      <h3>Transit & Commute</h3>
                      <p>{review.infrastructure.transit}</p>
                    </div>
                    <div>
                      <h3>Education & Catchments</h3>
                      <p>{review.infrastructure.education}</p>
                    </div>
                    <div>
                      <h3>Lifestyle & Amenities</h3>
                      <p>{review.infrastructure.lifestyle}</p>
                    </div>
                    <div>
                      <h3>Demographic Vibe</h3>
                      <p>{review.infrastructure.demographic}</p>
                    </div>
                  </section>
                )}

                {activeTab === 'map' && (
                  <section className="tab-panel map-panel">
                    <div className="map-copy">
                      <div>
                        <h3>Map location</h3>
                        <p>
                          Explore {review.suburb}, {review.state} in Google Maps.
                        </p>
                      </div>
                      <a className="map-open-link" href={toGoogleMapsUrl(review)} target="_blank" rel="noreferrer">
                        Open in Google Maps
                      </a>
                    </div>
                    <div className="map-frame-wrap">
                      <iframe
                        title={`${review.suburb}, ${review.state} map`}
                        src={toGoogleMapsEmbedUrl(review)}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                        allowFullScreen
                      />
                    </div>
                  </section>
                )}
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
          <div>
            <h2>Make a smarter move with a clearer view.</h2>
          </div>
        </section>
      )}

      <footer className="site-footer">
        <p>© {new Date().getFullYear()} Michael Soutar</p>
      </footer>
    </main>
  )
}

export default App

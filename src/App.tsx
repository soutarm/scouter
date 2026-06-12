import { useMemo, useState } from 'react'
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

type ReviewSectionKey = 'property' | 'climate' | 'crime' | 'infrastructure'

type MarketRow = {
  propertyType: string
  medianPrice: string
  twelveMonthGrowth: string
  medianWeeklyRent: string
  grossYield: string
}

type Review = {
  suburb: string
  state: string
  generatedAt: string
  summary: string
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
}

const STORAGE_KEY = 'scouter.llm-settings'
const REQUEST_TIMEOUT_MS = 60_000

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

const examples = ['Heidelberg, VIC', 'Rosanna, VIC', 'Ivanhoe, VIC', 'Eaglemont, VIC']

const tabs: Array<{ key: ReviewSectionKey; label: string }> = [
  { key: 'property', label: 'Property' },
  { key: 'climate', label: 'Climate' },
  { key: 'crime', label: 'Crime' },
  { key: 'infrastructure', label: 'Infrastructure' },
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

const stripJsonFence = (value: string) =>
  value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()

const buildPrompt = (query: string) => `You are an Australian suburb research analyst.

Create a concise but useful suburb review for: ${query}.

Return JSON only. Do not include markdown fences. Use current 2026 context where possible. Use AUD for money. Do not use em dashes.

JSON shape:
{
  "suburb": "Suburb name",
  "state": "State abbreviation",
  "generatedAt": "ISO timestamp",
  "summary": "Top-level practical assessment in 2-4 sentences.",
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
  "caveats": ["Any uncertainty, unavailable fresh data, or source limitation."]
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

function App() {
  const [query, setQuery] = useState('')
  const [settings, setSettings] = useState<LlmSettings>(() => loadSettings())
  const [showSettings, setShowSettings] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [activeTab, setActiveTab] = useState<ReviewSectionKey>('property')
  const [isLoading, setIsLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState('')
  const [saveStatus, setSaveStatus] = useState('Loaded from this browser')
  const [requestStatus, setRequestStatus] = useState('')
  const [fallbackPrompt, setFallbackPrompt] = useState('')

  const providerReady = useMemo(() => {
    if (settings.provider === 'azure') {
      return Boolean(settings.azureEndpoint && settings.azureDeployment && settings.azureApiKey)
    }
    return Boolean(settings.openAiApiKey && settings.openAiModel)
  }, [settings])

  const updateSettings = (next: LlmSettings) => {
    setSettings(next)
    saveSettings(next)
    setSaveStatus(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return

    if (!providerReady) {
      setShowSettings(true)
      setError('Add LLM settings before running a review.')
      return
    }

    setIsLoading(true)
    setError('')
    setFallbackPrompt('')
    setRequestStatus('Contacting LLM provider...')
    setReview(null)
    setActiveTab('property')
    try {
      const result = await callLlm(settings, trimmedQuery)
      setReview({ ...result, generatedAt: result.generatedAt || new Date().toISOString() })
      setRequestStatus('Review generated')
    } catch (caught) {
      setError(friendlyRequestError(caught))
      setFallbackPrompt(buildPrompt(trimmedQuery))
      setRequestStatus('Review failed')
    } finally {
      setIsLoading(false)
    }
  }

  const copyPrompt = async () => {
    if (!fallbackPrompt) return
    await navigator.clipboard.writeText(fallbackPrompt)
    setRequestStatus('Prompt copied')
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
        <div>
          <p className="eyebrow">Static suburb intelligence</p>
          <h1>Scouter</h1>
        </div>
        <button className="ghost-button" type="button" onClick={() => setShowSettings((open) => !open)}>
          LLM settings
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

      <section className="hero-panel">
        <div className="hero-copy">
          <span className="pill">Property, climate, crime, logistics</span>
          <h2>Generate a practical suburb review in one pass.</h2>
          <p>
            Enter a suburb and state, run the review, then scan the summary or jump through each section.
          </p>
        </div>
        <form className="search-card" onSubmit={handleSubmit}>
          <label htmlFor="suburb-query">Suburb search</label>
          <div className="search-row">
            <input
              id="suburb-query"
              list="suburb-examples"
              placeholder="e.g. Heidelberg, VIC"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={isLoading}
            />
            <button type="submit" disabled={isLoading || !query.trim()}>
              {isLoading ? 'Reviewing...' : 'Run review'}
            </button>
          </div>
          <datalist id="suburb-examples">
            {examples.map((example) => (
              <option key={example} value={example} />
            ))}
          </datalist>
          <div className="example-row">
            {examples.map((example) => (
              <button key={example} type="button" onClick={() => setQuery(example)}>
                {example}
              </button>
            ))}
          </div>
        </form>
      </section>

      {isLoading && (
        <section className="busy-card" aria-live="polite">
          <div className="spinner" />
          <div>
            <h2>Building the review</h2>
            <p>{requestStatus || 'Asking the model for structured market, climate, safety and logistics sections.'}</p>
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
          <div className="review-actions">
            <div>
              <p className="eyebrow">Generated review</p>
              <h2>
                {review.suburb}, {review.state}
              </h2>
            </div>
            <button type="button" className="primary-lite" onClick={downloadPdf} disabled={isExporting}>
              {isExporting ? 'Preparing PDF...' : 'Download PDF'}
            </button>
          </div>

          <article className="review-card">
            <section className="summary-card">
              <div>
                <p className="eyebrow">Summary</p>
                <h2>
                  {review.suburb}, {review.state} Profile
                </h2>
              </div>
              <p>{review.summary}</p>
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
              <section className="tab-panel split-panel">
                <div>
                  <h3>Summer Averages</h3>
                  <p>{review.climate.summerAverages}</p>
                </div>
                <div>
                  <h3>Winter Averages</h3>
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

            {review.caveats?.length > 0 && (
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
            <h2>Designed for fast suburb decisions.</h2>
            <p>
              The app runs fully in the browser, keeps provider settings local, and builds a structured
              review ready for PDF export.
            </p>
          </div>
          <div className="mini-card">Static deploy ready</div>
          <div className="mini-card">Pastel green UI</div>
          <div className="mini-card">Structured LLM output</div>
        </section>
      )}
    </main>
  )
}

export default App

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LlmSettings, ProviderKind } from '../types'

type CacheStatus = 'stale' | 'busy' | 'updated'

type Props = {
  settings: LlmSettings
  providerReady: boolean
  saveStatus: string
  cacheCount: number
  cacheStatus: CacheStatus
  onUpdate: (next: LlmSettings) => void
  onClearCache: () => void
  onClearCurrentLocation: () => void
  onClose?: () => void
}

type ModelOption = { value: string; label: string }

// Fallback lists used before a key is entered or if the fetch fails
const FALLBACK_OPENAI: ModelOption[] = [
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' },
]

const FALLBACK_GEMINI: ModelOption[] = [
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
]

const FALLBACK_ANTHROPIC: ModelOption[] = [
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { value: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
]

const FALLBACK_DEEPSEEK: ModelOption[] = [
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
  { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
]

const apiKeyLinks: Record<ProviderKind, { label: string; href: string }> = {
  gemini:    { label: 'Google Gemini API Key', href: 'https://aistudio.google.com/app/apikey' },
  openai:    { label: 'OpenAI GPT API Key',    href: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic Claude API Key', href: 'https://console.anthropic.com/settings/keys' },
  deepseek:  { label: 'DeepSeek API Key',      href: 'https://platform.deepseek.com/api_keys' },
  azure:     { label: 'Azure AI API Key',       href: 'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/create-resource' },
}

// Fetch live model lists from provider APIs
async function fetchOpenAiModels(apiKey: string, baseUrl: string): Promise<ModelOption[]> {
  const base = baseUrl.replace(/\/$/, '') || 'https://api.openai.com'
  const res = await fetch(`${base}/v1/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return []
  const data = await res.json() as { data?: Array<{ id: string }> }
  return (data.data ?? [])
    .map(m => m.id)
    .filter(id => /^gpt-|^o[1-9]/.test(id))
    .sort((a, b) => b.localeCompare(a))
    .map(id => ({ value: id, label: id }))
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) return []
  const data = await res.json() as { data?: Array<{ id: string; display_name?: string }> }
  return (data.data ?? []).map(m => ({ value: m.id, label: m.display_name ?? m.id }))
}

async function fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=50`,
    { signal: AbortSignal.timeout(8_000) },
  )
  if (!res.ok) return []
  const data = await res.json() as { models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }> }
  return (data.models ?? [])
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .filter(m => m.name.includes('gemini'))
    .map(m => ({
      value: m.name.replace('models/', ''),
      label: m.displayName ?? m.name.replace('models/', ''),
    }))
    .sort((a, b) => b.value.localeCompare(a.value))
}

const ProviderIcon = ({ ready, label }: { ready: boolean; label: string }) => (
  <span
    className={ready ? 'cache-pill cache-pill--provider-ready' : 'cache-pill cache-pill--provider-waiting'}
    title={label}
    aria-label={label}
  >
    {ready ? (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      </svg>
    ) : (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M8 5v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="8" cy="11" r="0.8" fill="currentColor"/>
      </svg>
    )}
  </span>
)

const CacheIcon = ({ status }: { status: CacheStatus }) => {
  if (status === 'busy') return (
    <span className="cache-pill cache-pill--busy" title="Updating cache…" aria-label="Cache busy">
      <span className="cache-pill-spinner" aria-hidden="true" />
    </span>
  )
  if (status === 'updated') return (
    <span className="cache-pill cache-pill--updated" title="Cache updated" aria-label="Cache updated">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  )
  return (
    <span className="cache-pill cache-pill--stale" title="Cache ready" aria-label="Cache ready">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
    </span>
  )
}

// Debounce a value by ms
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return debounced
}

export const SettingsPanel = ({
  settings,
  providerReady,
  saveStatus,
  cacheCount,
  cacheStatus,
  onUpdate,
  onClearCache,
  onClearCurrentLocation,
  onClose,
}: Props) => {
  const [openAiModels, setOpenAiModels] = useState<ModelOption[]>(FALLBACK_OPENAI)
  const [geminiModels, setGeminiModels] = useState<ModelOption[]>(FALLBACK_GEMINI)
  const [anthropicModels, setAnthropicModels] = useState<ModelOption[]>(FALLBACK_ANTHROPIC)
  const [fetchingModels, setFetchingModels] = useState(false)
  const lastFetchKey = useRef<string>('')

  const debouncedOpenAiKey = useDebounced(settings.openAiApiKey, 800)
  const debouncedGeminiKey = useDebounced(settings.geminiApiKey, 800)
  const debouncedAnthropicKey = useDebounced(settings.anthropicApiKey, 800)

  // Fetch models whenever the active provider's key changes (uses debounced keys to build cache key)
  const doFetch = useCallback(async (provider: ProviderKind) => {
    const fetchKey = `${provider}:${debouncedOpenAiKey}:${debouncedGeminiKey}:${debouncedAnthropicKey}:${settings.openAiBaseUrl}`
    if (fetchKey === lastFetchKey.current) return
    lastFetchKey.current = fetchKey

    if (provider === 'openai' && debouncedOpenAiKey) {
      setFetchingModels(true)
      const models = await fetchOpenAiModels(debouncedOpenAiKey, settings.openAiBaseUrl)
      if (models.length > 0) setOpenAiModels(models)
      setFetchingModels(false)
    } else if (provider === 'gemini' && debouncedGeminiKey) {
      setFetchingModels(true)
      const models = await fetchGeminiModels(debouncedGeminiKey)
      if (models.length > 0) setGeminiModels(models)
      setFetchingModels(false)
    } else if (provider === 'anthropic' && debouncedAnthropicKey) {
      setFetchingModels(true)
      const models = await fetchAnthropicModels(debouncedAnthropicKey)
      if (models.length > 0) setAnthropicModels(models)
      setFetchingModels(false)
    }
  }, [debouncedOpenAiKey, debouncedGeminiKey, debouncedAnthropicKey, settings.openAiBaseUrl])

  useEffect(() => {
    doFetch(settings.provider)
  }, [settings.provider, doFetch])

  const isCustomOpenAiModel    = !openAiModels.some(o => o.value === settings.openAiModel)
  const isCustomGeminiModel    = !geminiModels.some(o => o.value === settings.geminiModel)
  const isCustomAnthropicModel = !anthropicModels.some(o => o.value === settings.anthropicModel)
  const isCustomDeepseekModel  = !FALLBACK_DEEPSEEK.some(o => o.value === settings.deepseekModel)
  const selectedApiKeyLink     = apiKeyLinks[settings.provider]

  return (
  <section
    className="settings-card"
    aria-label="LLM settings"
    role="dialog"
    aria-modal="true"
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
  >
    {onClose && (
      <button
        className="settings-close-btn"
        aria-label="Close settings"
        onClick={onClose}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    )}
    <div className="settings-header">
      <div>
        <h2>Provider settings</h2>
      </div>
    </div>
    <select
      className="settings-provider-select"
      value={settings.provider}
      onChange={(e) => onUpdate({ ...settings, provider: e.target.value as ProviderKind })}
    >
      <option value="gemini">Google Gemini</option>
      <option value="openai">OpenAI GPT</option>
      <option value="anthropic">Anthropic Claude</option>
      <option value="deepseek">DeepSeek</option>
      <option value="azure">Azure AI</option>
    </select>

    {settings.provider === 'azure' ? (
      <div className="settings-grid">
        <label>
          Endpoint
          <input placeholder="https://example.openai.azure.com" value={settings.azureEndpoint}
            onChange={(e) => onUpdate({ ...settings, azureEndpoint: e.target.value })} />
        </label>
        <label>
          Deployment
          <input placeholder="gpt-4.1-mini" value={settings.azureDeployment}
            onChange={(e) => onUpdate({ ...settings, azureDeployment: e.target.value })} />
        </label>
        <label>
          API version
          <input value={settings.azureApiVersion}
            onChange={(e) => onUpdate({ ...settings, azureApiVersion: e.target.value })} />
        </label>
        <label>
          API key
          <input type="password" value={settings.azureApiKey}
            onChange={(e) => onUpdate({ ...settings, azureApiKey: e.target.value })} />
        </label>
      </div>
    ) : settings.provider === 'gemini' ? (
      <div className="settings-grid">
        <label>
          API key
          <input type="password" value={settings.geminiApiKey}
            onChange={(e) => onUpdate({ ...settings, geminiApiKey: e.target.value })} />
        </label>
        <label>
          Model{fetchingModels ? ' (loading…)' : ''}
          <select
            className="settings-provider-select"
            value={isCustomGeminiModel ? '__custom__' : settings.geminiModel}
            onChange={(e) => {
              const v = e.target.value
              onUpdate({ ...settings, geminiModel: v === '__custom__' ? '' : v })
            }}
          >
            {geminiModels.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__custom__">Custom model</option>
          </select>
        </label>
        {isCustomGeminiModel && (
          <label>
            Custom model
            <input placeholder="gemini-model-name" value={settings.geminiModel}
              onChange={(e) => onUpdate({ ...settings, geminiModel: e.target.value })} />
          </label>
        )}
        <p className="settings-note settings-note--full">
          Uses Google AI Studio&apos;s Gemini API directly from this browser. Keep keys restricted where possible.
        </p>
      </div>
    ) : settings.provider === 'anthropic' ? (
      <div className="settings-grid">
        <label>
          API key
          <input type="password" value={settings.anthropicApiKey}
            onChange={(e) => onUpdate({ ...settings, anthropicApiKey: e.target.value })} />
        </label>
        <label>
          Model{fetchingModels ? ' (loading…)' : ''}
          <select
            className="settings-provider-select"
            value={isCustomAnthropicModel ? '__custom__' : settings.anthropicModel}
            onChange={(e) => {
              const v = e.target.value
              onUpdate({ ...settings, anthropicModel: v === '__custom__' ? '' : v })
            }}
          >
            {anthropicModels.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__custom__">Custom model</option>
          </select>
        </label>
        {isCustomAnthropicModel && (
          <label>
            Custom model
            <input placeholder="claude-model-name" value={settings.anthropicModel}
              onChange={(e) => onUpdate({ ...settings, anthropicModel: e.target.value })} />
          </label>
        )}
        <p className="settings-note settings-note--full">
          Uses Anthropic&apos;s Messages API directly from this browser. Keep keys restricted where possible.
        </p>
      </div>
    ) : settings.provider === 'deepseek' ? (
      <div className="settings-grid">
        <label>
          API key
          <input type="password" value={settings.deepseekApiKey}
            onChange={(e) => onUpdate({ ...settings, deepseekApiKey: e.target.value })} />
        </label>
        <label>
          Model
          <select
            className="settings-provider-select"
            value={isCustomDeepseekModel ? '__custom__' : settings.deepseekModel}
            onChange={(e) => {
              const v = e.target.value
              onUpdate({ ...settings, deepseekModel: v === '__custom__' ? '' : v })
            }}
          >
            {FALLBACK_DEEPSEEK.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__custom__">Custom model</option>
          </select>
        </label>
        {isCustomDeepseekModel && (
          <label>
            Custom model
            <input placeholder="deepseek-model-name" value={settings.deepseekModel}
              onChange={(e) => onUpdate({ ...settings, deepseekModel: e.target.value })} />
          </label>
        )}
        <p className="settings-note settings-note--full">
          Uses DeepSeek&apos;s Chat Completions API directly from this browser. Keep keys restricted where possible.
        </p>
      </div>
    ) : (
      <div className="settings-grid">
        <label>
          Base URL
          <input value={settings.openAiBaseUrl}
            onChange={(e) => onUpdate({ ...settings, openAiBaseUrl: e.target.value })} />
        </label>
        <label>
          API key
          <input type="password" value={settings.openAiApiKey}
            onChange={(e) => onUpdate({ ...settings, openAiApiKey: e.target.value })} />
        </label>
        <label>
          Model{fetchingModels ? ' (loading…)' : ''}
          <select
            className="settings-provider-select"
            value={isCustomOpenAiModel ? '__custom__' : settings.openAiModel}
            onChange={(e) => {
              const v = e.target.value
              onUpdate({ ...settings, openAiModel: v === '__custom__' ? '' : v })
            }}
          >
            {openAiModels.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__custom__">Custom model</option>
          </select>
        </label>
        {isCustomOpenAiModel && (
          <label>
            Custom model
            <input placeholder="model-name" value={settings.openAiModel}
              onChange={(e) => onUpdate({ ...settings, openAiModel: e.target.value })} />
          </label>
        )}
      </div>
    )}

    <div className="settings-api-links" aria-label="API key setup links">
      <span>Get API key</span>
      <a href={selectedApiKeyLink.href} target="_blank" rel="noreferrer">
        {selectedApiKeyLink.label}
      </a>
    </div>

    <p className="settings-storage-note">
      <span className="settings-storage-icon" aria-hidden="true">i</span>
      Stored locally in this browser. Do not use public/shared API keys.
    </p>

    <div className="settings-footer">
      <div className="settings-footer-buttons">
        <button
          type="button"
          className="clear-link-button"
          onClick={onClearCache}
        >
          Clear cache
        </button>
        <button
          type="button"
          className="clear-link-button"
          onClick={onClearCurrentLocation}
        >
          Clear current location
        </button>
      </div>
    </div>
    <div className="settings-status-row" aria-live="polite">
      <ProviderIcon ready={providerReady} label={providerReady ? `Ready · ${saveStatus}` : saveStatus} />
      <CacheIcon status={cacheStatus} />
      <span className="cache-pill-label">{cacheCount} {cacheCount === 1 ? 'location' : 'locations'}</span>
      <span className="settings-version">v1.2.20</span>
    </div>
  </section>
  )
}

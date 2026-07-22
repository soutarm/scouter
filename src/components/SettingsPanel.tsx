import { useCallback, useEffect, useRef, useState } from 'react'
import type { LlmSettings, ProviderKind } from '../types'
import { testLlmConnection } from '../services/llm'

type Props = {
  settings: LlmSettings
  onUpdate: (next: LlmSettings) => void
  onClearCache: () => void
  onClearCurrentLocation: () => void
  onClose?: () => void
}

type ModelOption = { value: string; label: string }

// Fallback lists used before a key is entered or if the fetch fails
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

// No entry for 'free' - it needs no external API key, so the link row is hidden for it.
// No entry for 'openai' either - its link comes from the active OPENAI_PRESETS entry instead.
const apiKeyLinks: Partial<Record<ProviderKind, { label: string; href: string }>> = {
  gemini:    { label: 'Get Google Gemini API Key', href: 'https://aistudio.google.com/app/apikey' },
  anthropic: { label: 'Get Anthropic Claude API Key', href: 'https://console.anthropic.com/settings/keys' },
  azure:     { label: 'Get Azure AI API Key',       href: 'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/create-resource' },
}

// Known OpenAI-compatible services, selectable from the Service dropdown under the
// "OpenAI" provider. Selecting one auto-fills the base URL and swaps the model list -
// this is what lets Kimi/DeepSeek/OpenRouter/etc. reuse the single generic request
// path in llm.ts instead of each needing their own dedicated branch. "Custom" is
// always last and matches anything that isn't one of the known base URLs.
type OpenAiPreset = {
  id: string
  label: string
  baseUrl: string
  apiKeyLink?: { label: string; href: string }
  fallbackModels: ModelOption[]
  note: string
}

const OPENAI_PRESETS: OpenAiPreset[] = [
  {
    id: 'openai',
    label: 'GPT',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyLink: { label: 'Get OpenAI API Key', href: 'https://platform.openai.com/api-keys' },
    fallbackModels: [
      { value: 'gpt-4.1', label: 'GPT-4.1' },
      { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { value: 'gpt-4o', label: 'GPT-4o' },
    ],
    note: "Uses OpenAI's Chat Completions API directly from this browser. Keep keys restricted where possible.",
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKeyLink: { label: 'Get DeepSeek API Key', href: 'https://platform.deepseek.com/api_keys' },
    fallbackModels: [
      { value: 'deepseek-chat', label: 'DeepSeek Chat' },
      { value: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
    note: "Uses DeepSeek's OpenAI-compatible Chat Completions API directly from this browser.",
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot AI)',
    baseUrl: 'https://api.moonshot.ai/v1',
    apiKeyLink: { label: 'Get Moonshot API Key', href: 'https://platform.moonshot.ai/console/api-keys' },
    fallbackModels: [
      { value: 'kimi-k2-turbo-preview', label: 'Kimi K2 Turbo' },
      { value: 'kimi-k2-0711-preview', label: 'Kimi K2' },
    ],
    note: "Uses Moonshot AI's OpenAI-compatible API directly from this browser. Check moonshot.ai's docs if a model name below has moved on.",
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKeyLink: { label: 'Get OpenRouter API Key', href: 'https://openrouter.ai/keys' },
    fallbackModels: [],
    note: 'Routes to hundreds of models from one key. Browse openrouter.ai/models and paste a model slug below - append :free for no-cost open-weight models.',
  },
  {
    id: 'custom',
    label: 'Custom',
    baseUrl: '',
    fallbackModels: [],
    note: 'Works with any OpenAI-compatible endpoint - point Base URL at its API root.',
  },
]

const findOpenAiPreset = (baseUrl: string): OpenAiPreset =>
  OPENAI_PRESETS.find(p => p.id !== 'custom' && p.baseUrl === baseUrl) ?? OPENAI_PRESETS[OPENAI_PRESETS.length - 1]

// Fetch live model lists from provider APIs. Every path returns [] rather than
// throwing - a thrown error here would otherwise leave the "fetching" state (and
// the loading… label) stuck forever, since nothing downstream ever catches it.
async function fetchOpenAiModels(apiKey: string, baseUrl: string): Promise<ModelOption[]> {
  try {
    // baseUrl already includes the /v1 segment (matches how llm.ts builds the
    // chat-completions URL) - appending /v1/models here would double it up and 404.
    const base = baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1'
    const res = await fetch(`${base}/models`, {
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
  } catch {
    return []
  }
}

async function fetchAnthropicModels(apiKey: string): Promise<ModelOption[]> {
  try {
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
  } catch {
    return []
  }
}

async function fetchGeminiModels(apiKey: string): Promise<ModelOption[]> {
  try {
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
  } catch {
    return []
  }
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
  onUpdate,
  onClearCache,
  onClearCurrentLocation,
  onClose,
}: Props) => {
  const activePreset = findOpenAiPreset(settings.openAiBaseUrl)

  const [openAiModels, setOpenAiModels] = useState<ModelOption[]>(activePreset.fallbackModels)
  const [geminiModels, setGeminiModels] = useState<ModelOption[]>(FALLBACK_GEMINI)
  const [anthropicModels, setAnthropicModels] = useState<ModelOption[]>(FALLBACK_ANTHROPIC)
  const [fetchingModels, setFetchingModels] = useState(false)
  const lastFetchKey = useRef<string>('')
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ settings: LlmSettings; ok: boolean; message: string } | null>(null)

  const debouncedOpenAiKey = useDebounced(settings.openAiApiKey, 800)
  const debouncedGeminiKey = useDebounced(settings.geminiApiKey, 800)
  const debouncedAnthropicKey = useDebounced(settings.anthropicApiKey, 800)

  // Fetch models whenever the active provider's key changes (uses debounced keys to build cache key).
  // lastFetchKey is only updated on a successful (non-empty) result, so a failed attempt
  // (bad key, transient network error, a bug since fixed, etc.) doesn't permanently block
  // retrying - the next time doFetch runs for the same inputs, it tries again instead of
  // silently no-op'ing forever. Live model-fetching only applies to the real OpenAI API -
  // its filter (gpt-*/o[1-9]) and /models response shape aren't guaranteed for other
  // OpenAI-compatible services, which use their preset's static fallback list instead.
  const doFetch = useCallback(async (provider: ProviderKind) => {
    const fetchKey = `${provider}:${debouncedOpenAiKey}:${debouncedGeminiKey}:${debouncedAnthropicKey}:${settings.openAiBaseUrl}`
    if (fetchKey === lastFetchKey.current) return
    const preset = findOpenAiPreset(settings.openAiBaseUrl)

    // try/finally is a safety net: fetchOpenAiModels et al. already catch their own
    // errors and resolve to [], but this guarantees the loading state can never get
    // stuck even if something unexpected throws.
    if (provider === 'openai' && preset.id === 'openai' && debouncedOpenAiKey) {
      setFetchingModels(true)
      try {
        const models = await fetchOpenAiModels(debouncedOpenAiKey, settings.openAiBaseUrl)
        if (models.length > 0) { setOpenAiModels(models); lastFetchKey.current = fetchKey }
      } finally {
        setFetchingModels(false)
      }
    } else if (provider === 'gemini' && debouncedGeminiKey) {
      setFetchingModels(true)
      try {
        const models = await fetchGeminiModels(debouncedGeminiKey)
        if (models.length > 0) { setGeminiModels(models); lastFetchKey.current = fetchKey }
      } finally {
        setFetchingModels(false)
      }
    } else if (provider === 'anthropic' && debouncedAnthropicKey) {
      setFetchingModels(true)
      try {
        const models = await fetchAnthropicModels(debouncedAnthropicKey)
        if (models.length > 0) { setAnthropicModels(models); lastFetchKey.current = fetchKey }
      } finally {
        setFetchingModels(false)
      }
    }
  }, [debouncedOpenAiKey, debouncedGeminiKey, debouncedAnthropicKey, settings.openAiBaseUrl])

  useEffect(() => {
    doFetch(settings.provider)
  }, [settings.provider, doFetch])

  const handleTestLlm = useCallback(async () => {
    setIsTesting(true)
    const result = await testLlmConnection(settings)
    setIsTesting(false)
    setTestResult({
      settings,
      ok: result.ok,
      message: result.ok
        ? `Responded in ${result.durationMs}ms: "${result.reply}"`
        : `${result.error} (${result.durationMs}ms)`,
    })
  }, [settings])

  // A settings object is a fresh reference on every field edit, so a stored result
  // naturally stops matching (and hides itself) the moment anything changes.
  const showTestResult = testResult !== null && testResult.settings === settings

  const openAiModelOptions     = activePreset.id === 'openai' ? openAiModels : activePreset.fallbackModels
  const isCustomOpenAiModel    = !openAiModelOptions.some(o => o.value === settings.openAiModel)
  const isCustomGeminiModel    = !geminiModels.some(o => o.value === settings.geminiModel)
  const isCustomAnthropicModel = !anthropicModels.some(o => o.value === settings.anthropicModel)
  const selectedApiKeyLink     = settings.provider === 'openai' ? activePreset.apiKeyLink : apiKeyLinks[settings.provider]

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
        <h2>AI Settings</h2>
      </div>
    </div>
    <select
      id="llm-provider"
      name="llm-provider"
      className="settings-provider-select"
      value={settings.provider}
      onChange={(e) => onUpdate({ ...settings, provider: e.target.value as ProviderKind })}
    >
      <option value="free">Free (no setup)</option>
      <option value="gemini">Google Gemini</option>
      <option value="openai">OpenAI</option>
      <option value="anthropic">Anthropic Claude</option>
      <option value="azure">Azure AI</option>
    </select>

    {settings.provider === 'free' ? (
      <div className="settings-grid">
        <p className="settings-note settings-note--full">
          Uses Scouter&apos;s shared free-tier model (GPT-OSS 20B via OpenRouter), no API key
          needed. Limited to a few reviews per day per visitor. Switch to another provider above
          and add your own API key for unlimited use, faster responses, and higher-quality output.
        </p>
      </div>
    ) : settings.provider === 'azure' ? (
      <div className="settings-grid">
        <label>
          Endpoint
          <input id="llm-azure-endpoint" name="llm-azure-endpoint" autoComplete="url"
            placeholder="https://example.openai.azure.com" value={settings.azureEndpoint}
            onChange={(e) => onUpdate({ ...settings, azureEndpoint: e.target.value })} />
        </label>
        <label>
          Deployment
          <input id="llm-azure-deployment" name="llm-azure-deployment"
            placeholder="gpt-4.1-mini" value={settings.azureDeployment}
            onChange={(e) => onUpdate({ ...settings, azureDeployment: e.target.value })} />
        </label>
        <label>
          API version
          <input id="llm-azure-api-version" name="llm-azure-api-version" value={settings.azureApiVersion}
            onChange={(e) => onUpdate({ ...settings, azureApiVersion: e.target.value })} />
        </label>
        <label>
          API key
          <input id="llm-azure-api-key" name="llm-azure-api-key" type="password" value={settings.azureApiKey}
            onChange={(e) => onUpdate({ ...settings, azureApiKey: e.target.value })} />
        </label>
      </div>
    ) : settings.provider === 'gemini' ? (
      <div className="settings-grid">
        <label>
          API key
          <input id="llm-gemini-api-key" name="llm-gemini-api-key" type="password" value={settings.geminiApiKey}
            onChange={(e) => onUpdate({ ...settings, geminiApiKey: e.target.value })} />
        </label>
        <label>
          Model{fetchingModels ? ' (loading…)' : ''}
          <select
            id="llm-gemini-model"
            name="llm-gemini-model"
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
            <input id="llm-gemini-model-custom" name="llm-gemini-model-custom"
              placeholder="gemini-model-name" value={settings.geminiModel}
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
          <input id="llm-anthropic-api-key" name="llm-anthropic-api-key" type="password" value={settings.anthropicApiKey}
            onChange={(e) => onUpdate({ ...settings, anthropicApiKey: e.target.value })} />
        </label>
        <label>
          Model{fetchingModels ? ' (loading…)' : ''}
          <select
            id="llm-anthropic-model"
            name="llm-anthropic-model"
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
            <input id="llm-anthropic-model-custom" name="llm-anthropic-model-custom"
              placeholder="claude-model-name" value={settings.anthropicModel}
              onChange={(e) => onUpdate({ ...settings, anthropicModel: e.target.value })} />
          </label>
        )}
        <p className="settings-note settings-note--full">
          Uses Anthropic&apos;s Messages API directly from this browser. Keep keys restricted where possible.
        </p>
      </div>
    ) : (
      <div className="settings-grid">
        <label>
          Service
          <select
            id="llm-openai-service"
            name="llm-openai-service"
            className="settings-provider-select"
            value={activePreset.id}
            onChange={(e) => {
              const preset = OPENAI_PRESETS.find(p => p.id === e.target.value) ?? OPENAI_PRESETS[OPENAI_PRESETS.length - 1]
              onUpdate({ ...settings, openAiBaseUrl: preset.baseUrl, openAiModel: preset.fallbackModels[0]?.value ?? '' })
            }}
          >
            {OPENAI_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
        {activePreset.id === 'custom' && (
          <label>
            Base URL
            <input id="llm-openai-base-url" name="llm-openai-base-url" autoComplete="url" value={settings.openAiBaseUrl}
              onChange={(e) => onUpdate({ ...settings, openAiBaseUrl: e.target.value })} />
          </label>
        )}
        <label>
          API key
          <input id="llm-openai-api-key" name="llm-openai-api-key" type="password" value={settings.openAiApiKey}
            onChange={(e) => onUpdate({ ...settings, openAiApiKey: e.target.value })} />
        </label>
        <label>
          Model{fetchingModels ? ' (loading…)' : ''}
          <select
            id="llm-openai-model"
            name="llm-openai-model"
            className="settings-provider-select"
            value={isCustomOpenAiModel ? '__custom__' : settings.openAiModel}
            onChange={(e) => {
              const v = e.target.value
              onUpdate({ ...settings, openAiModel: v === '__custom__' ? '' : v })
            }}
          >
            {openAiModelOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            <option value="__custom__">Custom model</option>
          </select>
        </label>
        {isCustomOpenAiModel && (
          <label>
            Custom model
            <input id="llm-openai-model-custom" name="llm-openai-model-custom"
              placeholder="model-name" value={settings.openAiModel}
              onChange={(e) => onUpdate({ ...settings, openAiModel: e.target.value })} />
          </label>
        )}
        <p className="settings-note settings-note--full">
          {activePreset.note}
        </p>
      </div>
    )}

    {settings.provider !== 'free' && (
    <div className="settings-api-links" aria-label="API key and test actions">
      {selectedApiKeyLink && (
        <a href={selectedApiKeyLink.href} target="_blank" rel="noreferrer" className="settings-link-action">
          {selectedApiKeyLink.label}
        </a>
      )}
      <button
        type="button"
        className="settings-link-action"
        onClick={handleTestLlm}
        disabled={isTesting}
      >
        {isTesting ? 'Testing…' : 'Test LLM'}
      </button>
      {showTestResult && (
        <span
          className={`settings-test-icon ${testResult.ok ? 'settings-test-icon--success' : 'settings-test-icon--error'}`}
          title={testResult.message}
          aria-label={testResult.message}
        >
          {testResult.ok ? '✓' : '✕'}
        </span>
      )}
    </div>
    )}

    {settings.provider !== 'free' && (
      <p className="settings-storage-note">
        <span className="settings-storage-icon" aria-hidden="true">i</span>
        Stored locally in this browser. Do not use public/shared API keys.
      </p>
    )}

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
  </section>
  )
}

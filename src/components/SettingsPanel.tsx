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

const CUSTOM_GEMINI_MODEL = '__custom_gemini_model__'
const CUSTOM_ANTHROPIC_MODEL = '__custom_anthropic_model__'
const CUSTOM_OPENAI_MODEL = '__custom_openai_model__'

const openAiModelOptions = [
  { value: 'gpt-5.5', label: 'GPT-5.5' },
  { value: 'gpt-5.4', label: 'GPT-5.4' },
  { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  { value: 'gpt-5.4-nano', label: 'GPT-5.4 Nano' },
  { value: 'gpt-5.1', label: 'GPT-5.1' },
  { value: 'gpt-5.1-mini', label: 'GPT-5.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
]

const geminiModelOptions = [
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (free)' },
  { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
  { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (free)' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite (free)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (free)' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (free)' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite (free)' },
]

const anthropicModelOptions = [
  { value: 'claude-fable-5', label: 'Claude Fable 5' },
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
]

const apiKeyLinks: Record<ProviderKind, { label: string; href: string }> = {
  gemini: { label: 'Google Gemini API Key', href: 'https://aistudio.google.com/app/apikey' },
  openai: { label: 'OpenAI GPT API Key', href: 'https://platform.openai.com/api-keys' },
  anthropic: { label: 'Anthropic Claude API Key', href: 'https://console.anthropic.com/settings/keys' },
  azure: { label: 'Azure AI API Key', href: 'https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/create-resource' },
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
  // stale
  return (
    <span className="cache-pill cache-pill--stale" title="Cache ready" aria-label="Cache ready">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
    </span>
  )
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
  const isCustomOpenAiModel = !openAiModelOptions.some((option) => option.value === settings.openAiModel)
  const isCustomGeminiModel = !geminiModelOptions.some((option) => option.value === settings.geminiModel)
  const isCustomAnthropicModel = !anthropicModelOptions.some((option) => option.value === settings.anthropicModel)
  const selectedApiKeyLink = apiKeyLinks[settings.provider]

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
          <input placeholder="gpt-5.4-mini" value={settings.azureDeployment}
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
          Model
          <select
            className="settings-provider-select"
            value={isCustomGeminiModel ? CUSTOM_GEMINI_MODEL : settings.geminiModel}
            onChange={(e) => {
              const model = e.target.value
              onUpdate({ ...settings, geminiModel: model === CUSTOM_GEMINI_MODEL ? '' : model })
            }}
          >
            {geminiModelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            <option value={CUSTOM_GEMINI_MODEL}>Custom model</option>
          </select>
        </label>
        {isCustomGeminiModel && (
          <label>
            Custom model
            <input placeholder="gemini-model-name" value={settings.geminiModel}
              onChange={(e) => onUpdate({ ...settings, geminiModel: e.target.value })} />
          </label>
        )}
        <label>
          API key
          <input type="password" value={settings.geminiApiKey}
            onChange={(e) => onUpdate({ ...settings, geminiApiKey: e.target.value })} />
        </label>
        <p className="settings-note settings-note--full">
          Uses Google AI Studio&apos;s Gemini API directly from this browser. Keep keys restricted where possible.
        </p>
      </div>
    ) : settings.provider === 'anthropic' ? (
      <div className="settings-grid">
        <label>
          Model
          <select
            className="settings-provider-select"
            value={isCustomAnthropicModel ? CUSTOM_ANTHROPIC_MODEL : settings.anthropicModel}
            onChange={(e) => {
              const model = e.target.value
              onUpdate({ ...settings, anthropicModel: model === CUSTOM_ANTHROPIC_MODEL ? '' : model })
            }}
          >
            {anthropicModelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            <option value={CUSTOM_ANTHROPIC_MODEL}>Custom model</option>
          </select>
        </label>
        {isCustomAnthropicModel && (
          <label>
            Custom model
            <input placeholder="claude-model-name" value={settings.anthropicModel}
              onChange={(e) => onUpdate({ ...settings, anthropicModel: e.target.value })} />
          </label>
        )}
        <label>
          API key
          <input type="password" value={settings.anthropicApiKey}
            onChange={(e) => onUpdate({ ...settings, anthropicApiKey: e.target.value })} />
        </label>
        <p className="settings-note settings-note--full">
          Uses Anthropic&apos;s Messages API directly from this browser. Keep keys restricted where possible.
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
          Model
          <select
            className="settings-provider-select"
            value={isCustomOpenAiModel ? CUSTOM_OPENAI_MODEL : settings.openAiModel}
            onChange={(e) => {
              const model = e.target.value
              onUpdate({ ...settings, openAiModel: model === CUSTOM_OPENAI_MODEL ? '' : model })
            }}
          >
            {openAiModelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
            <option value={CUSTOM_OPENAI_MODEL}>Custom model</option>
          </select>
        </label>
        {isCustomOpenAiModel && (
          <label>
            Custom model
            <input placeholder="openai-model-name" value={settings.openAiModel}
              onChange={(e) => onUpdate({ ...settings, openAiModel: e.target.value })} />
          </label>
        )}
        <label>
          API key
          <input type="password" value={settings.openAiApiKey}
            onChange={(e) => onUpdate({ ...settings, openAiApiKey: e.target.value })} />
        </label>
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
    </div>
  </section>
  )
}

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
}: Props) => (
  <section
    className="settings-card"
    aria-label="LLM settings"
    role="dialog"
    aria-modal="true"
    onClick={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
  >
    <div className="settings-header">
      <div>
        <p className="eyebrow">Configuration</p>
        <h2>Provider settings</h2>
      </div>
      <div className="settings-header-right">
        <div className="settings-controls">
          <select
            value={settings.provider}
            onChange={(e) => onUpdate({ ...settings, provider: e.target.value as ProviderKind })}
          >
            <option value="azure">Azure OpenAI</option>
            <option value="openai">OpenAI compatible</option>
            <option value="gemini">Google Gemini</option>
            <option value="anthropic">Anthropic</option>
          </select>
        </div>
      </div>
    </div>

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
          <input placeholder="gemini-2.5-flash" value={settings.geminiModel}
            onChange={(e) => onUpdate({ ...settings, geminiModel: e.target.value })} />
        </label>
        <label>
          API key
          <input type="password" value={settings.geminiApiKey}
            onChange={(e) => onUpdate({ ...settings, geminiApiKey: e.target.value })} />
        </label>
        <p className="settings-note">
          Uses Google AI Studio&apos;s Gemini API directly from this browser. Keep keys restricted where possible.
        </p>
      </div>
    ) : settings.provider === 'anthropic' ? (
      <div className="settings-grid">
        <label>
          Model
          <input placeholder="e.g. claude-opus-4-0" value={settings.anthropicModel}
            onChange={(e) => onUpdate({ ...settings, anthropicModel: e.target.value })} />
        </label>
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
          <input placeholder="gpt-5.4-mini" value={settings.openAiModel}
            onChange={(e) => onUpdate({ ...settings, openAiModel: e.target.value })} />
        </label>
        <label>
          API key
          <input type="password" value={settings.openAiApiKey}
            onChange={(e) => onUpdate({ ...settings, openAiApiKey: e.target.value })} />
        </label>
      </div>
    )}

    <p className="settings-storage-note">
      Stored locally in this browser. Do not use public/shared API keys.
    </p>

    <div className="settings-footer">
      <div className="settings-footer-buttons">
        <button
          type="button"
          className="clear-cache-button"
          onClick={onClearCache}
        >
          Clear cache &amp; recent searches
        </button>
        <button
          type="button"
          className="clear-cache-button"
          onClick={onClearCurrentLocation}
        >
          Clear current location
        </button>
      </div>
      <div className="cache-pill-wrap" aria-live="polite">
        <ProviderIcon ready={providerReady} label={providerReady ? `Ready · ${saveStatus}` : saveStatus} />
        <CacheIcon status={cacheStatus} />
        <span className="cache-pill-label">{cacheCount} {cacheCount === 1 ? 'location' : 'locations'}</span>
      </div>
    </div>
  </section>
)

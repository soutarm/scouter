import type { LlmSettings, ProviderKind } from '../types'
import { RECENT_SEARCHES_KEY, REVIEW_CACHE_KEY } from '../services/cache'

type Props = {
  settings: LlmSettings
  providerReady: boolean
  saveStatus: string
  onUpdate: (next: LlmSettings) => void
  onClearCache: () => void
}

export const SettingsPanel = ({ settings, providerReady, saveStatus, onUpdate, onClearCache }: Props) => (
  <section className="settings-card" aria-label="LLM settings" role="dialog" aria-modal="true">
    <div className="settings-header">
      <div>
        <p className="eyebrow">Configuration</p>
        <h2>Provider settings</h2>
        <p>Stored locally in this browser. Do not use public/shared API keys.</p>
      </div>
      <div className="settings-header-right">
        <div className="settings-controls">
          <span className={providerReady ? 'status-pill ready' : 'status-pill'}>
            {providerReady ? `Ready · ${saveStatus}` : saveStatus}
          </span>
          <select
            value={settings.provider}
            onChange={(e) => onUpdate({ ...settings, provider: e.target.value as ProviderKind })}
          >
            <option value="azure">Azure OpenAI</option>
            <option value="openai">OpenAI compatible</option>
            <option value="gemini">Google Gemini</option>
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

    <div className="settings-footer">
      <button
        type="button"
        className="clear-cache-button"
        onClick={() => {
          window.localStorage.removeItem(RECENT_SEARCHES_KEY)
          window.localStorage.removeItem(REVIEW_CACHE_KEY)
          onClearCache()
        }}
      >
        Clear cache &amp; recent searches
      </button>
    </div>
  </section>
)

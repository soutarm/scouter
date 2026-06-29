import type { FormEventHandler } from 'react'

import type { SuburbSuggestion } from '../types'

type Props = {
  showSetupCta: boolean
  isLoading: boolean
  query: string
  showSuggestions: boolean
  suggestions: SuburbSuggestion[]
  quickLocationTags: string[]
  compareMode: boolean
  compareKeys: string[]
  compareLocationTags: string[]
  composedQuery: string
  showCompareControls: boolean
  onSubmit: FormEventHandler<HTMLFormElement>
  onQueryChange: (value: string) => void
  onQueryFocus: () => void
  onQueryBlur: () => void
  onSuggestionSelect: (suggestion: SuburbSuggestion) => void
  onQuickLocationSelect: (search: string) => void
  onCompareModeChange: (enabled: boolean) => void
  onToggleCompareKey: (key: string) => void
  onRemoveLocation: (search: string) => void
  isRecentSearch: (search: string) => boolean
  isCompareKeyDisabled: (key: string) => boolean
  onOpenSettings: () => void
}

const LocationPinIcon = () => (
  <svg className="location-pin" aria-hidden="true" viewBox="0 0 24 24" focusable="false">
    <path d="M12 21s6.3-5.6 6.3-11.1A6.3 6.3 0 0 0 5.7 9.9C5.7 15.4 12 21 12 21Z" />
    <circle cx="12" cy="9.9" r="2.15" />
  </svg>
)

export const HeroSearchSection = ({
  showSetupCta,
  isLoading,
  query,
  showSuggestions,
  suggestions,
  quickLocationTags,
  compareMode,
  compareKeys,
  compareLocationTags,
  composedQuery,
  showCompareControls,
  onSubmit,
  onQueryChange,
  onQueryFocus,
  onQueryBlur,
  onSuggestionSelect,
  onQuickLocationSelect,
  onCompareModeChange,
  onToggleCompareKey,
  onRemoveLocation,
  isRecentSearch,
  isCompareKeyDisabled,
  onOpenSettings,
}: Props) => (
  <section className={`hero-panel${showSetupCta ? ' hero-panel--setup' : ''}`}>
    <div className="hero-copy">
      <h2>Scout a location before you make your move.</h2>
      {!showSetupCta && <p>Enter a location and let us scout it out.</p>}
    </div>
    <svg className="hero-contours" aria-hidden="true" viewBox="0 0 260 220" focusable="false">
      <path d="M231 13c-38 4-72 16-101 37-28 20-46 43-83 49-21 4-37 1-56-5" />
      <path d="M251 62c-36 7-66 20-91 39-32 24-50 53-95 57-25 2-43-5-65-18" />
      <path d="M243 118c-27 2-50 11-70 26-24 18-39 41-73 48-24 5-50 0-76-16" />
      <path d="M202 11c-16 23-23 45-20 66 4 28 24 49 21 82-2 19-11 34-27 48" />
    </svg>
    {showSetupCta ? (
      <section className="search-card setup-cta-card" aria-live="polite">
        <div className="setup-cta-row">
          <h3>Add your LLM provider settings to start scouting suburbs.</h3>
          <button type="button" className="primary-lite" onClick={onOpenSettings}>
            Add LLM config
          </button>
        </div>
      </section>
    ) : (
      <form className="search-card" onSubmit={onSubmit}>
        <div className="search-card-heading"><span>Location search</span></div>
        <div className="search-row">
          <div className="search-input-wrap">
            <input
              id="suburb-query"
              placeholder="Enter location name"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onBlur={onQueryBlur}
              onFocus={onQueryFocus}
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
                      onSuggestionSelect(s)
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
            {showCompareControls && (
              <div className="compare-toggle-row">
                <label className="compare-toggle-label">
                  <span className="ios-toggle">
                    <input
                      type="checkbox"
                      checked={compareMode}
                      onChange={(e) => onCompareModeChange(e.target.checked)}
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
            )}

            {compareMode && showCompareControls ? (
              <div className="quick-location-grid compare-select-grid" aria-label="Select locations to compare">
                {compareLocationTags.map((search) => {
                  const key = search.trim().toLowerCase()
                  const isSelected = compareKeys.includes(key)
                  const isDisabled = !isSelected && isCompareKeyDisabled(key)
                  return (
                    <button
                      key={search}
                      type="button"
                      className={`quick-location-tag quick-location-tag--compare${isSelected ? ' selected' : ''}${isDisabled ? ' disabled' : ''}`}
                      disabled={isDisabled}
                      aria-pressed={isSelected}
                      onClick={() => onToggleCompareKey(key)}
                    >
                      <LocationPinIcon />
                      <span>{search}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="quick-location-grid" aria-label="Quick location selections">
                {quickLocationTags.map((search) => (
                  <div key={search} className={`quick-location-tag-wrap${isRecentSearch(search) ? ' is-recent' : ''}`}>
                    <a
                      className="quick-location-tag"
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        onQuickLocationSelect(search)
                      }}
                    >
                      <LocationPinIcon />
                      <span>{search}</span>
                    </a>
                    {isRecentSearch(search) && (
                      <button
                        type="button"
                        className="quick-location-remove"
                        aria-label={`Remove ${search}`}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          onRemoveLocation(search)
                        }}
                      >
                        <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                          <line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {showCompareControls && compareMode && compareKeys.length === 0 && composedQuery && (
          <p className="mini-card">Select up to 6 cached locations to compare.</p>
        )}
      </form>
    )}
  </section>
)

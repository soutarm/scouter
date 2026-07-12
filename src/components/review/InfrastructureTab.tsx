import type { AustralianState, Review } from '../../types'
import { STATE_CBD, STATE_PT_URLS, haversineKm } from '../../services/location'

type Props = { review: Review }

// ---------------------------------------------------------------------------
// SVG icon set — each returns a <svg> sized for infra-stat-icon context
// ---------------------------------------------------------------------------

const IconPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s6.3-5.6 6.3-11.1A6.3 6.3 0 0 0 5.7 9.9C5.7 15.4 12 21 12 21Z" />
    <circle cx="12" cy="9.9" r="2.2" />
  </svg>
)

const IconClock = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

const IconBus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="13" rx="2" />
    <path d="M3 10h18M8 19v2M16 19v2" />
    <circle cx="7.5" cy="15" r="1" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="15" r="1" fill="currentColor" stroke="none" />
  </svg>
)

const IconTrain = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="4" y="3" width="16" height="14" rx="3" />
    <path d="M4 11h16M9 3v8M15 3v8M7 21l2-4M17 21l-2-4M7 17h10" />
    <circle cx="8.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
  </svg>
)

const IconTram = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="4" width="14" height="13" rx="2" />
    <path d="M5 10h14M9 4v6M15 4v6M8 21l1.5-4M16 21l-1.5-4M8 17h8" />
    <path d="M3 4h18" />
    <circle cx="8.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

const IconSchool = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21V9l9-6 9 6v12" />
    <path d="M9 21v-6h6v6" />
    <path d="M12 3v4" />
    <rect x="10" y="10" width="4" height="4" rx="0.5" />
  </svg>
)

const IconShopping = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
)

const IconPark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22V12" />
    <path d="M5 12h14" />
    <path d="M7 12c0-4 2.5-7 5-8.5C14.5 5 17 8 17 12" />
    <path d="M5 17c0-2.5 3-4 7-4s7 1.5 7 4" />
  </svg>
)

const IconMedical = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M12 8v8M8 12h8" />
  </svg>
)

const IconPoi = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const InfrastructureTab = ({ review }: Props) => {
  const stateKey = review.state.toUpperCase() as AustralianState
  const cbd = STATE_CBD[stateKey]
  const pt = STATE_PT_URLS[stateKey]
  const straightLineKm =
    review.infrastructure.suburbLat != null && review.infrastructure.suburbLng != null && cbd
      ? Math.round(haversineKm(review.infrastructure.suburbLat, review.infrastructure.suburbLng, cbd.lat, cbd.lng) * 10) / 10
      : review.infrastructure.cbdDistanceKm ?? null
  const mapsDirectionsUrl = cbd
    ? `https://www.google.com/maps/dir/${encodeURIComponent(`${review.suburb} ${review.state}`)}/${cbd.mapsQuery}`
    : null
  const totalSchools = (review.infrastructure.primarySchools ?? 0) + (review.infrastructure.secondarySchools ?? 0)

  return (
    <section className="tab-panel infra-panel">
      <div className="infra-stats-row">
        {straightLineKm != null && (
          <a className="infra-stat infra-stat-link" href={mapsDirectionsUrl ?? '#'} target="_blank" rel="noreferrer"
            title={`Straight-line distance to ${cbd?.name ?? 'CBD'} - open in Google Maps`}>
            <span className="infra-stat-icon"><IconPin /></span>
            <strong>{straightLineKm} km</strong>
            <span>to {cbd?.name ?? 'CBD'}</span>
            <span className="infra-stat-sublabel">straight-line</span>
          </a>
        )}
        {review.infrastructure.cbdCommuteMinutes != null && (
          <div className="infra-stat">
            <span className="infra-stat-icon"><IconClock /></span>
            <strong>{review.infrastructure.cbdCommuteMinutes} min</strong>
            <span>est. commute</span>
          </div>
        )}
        {review.infrastructure.busAvailability && (
          <a className="infra-stat infra-stat-link" href={pt?.bus ?? pt?.train ?? '#'} target="_blank" rel="noreferrer"
            title={`${pt?.label ?? 'Public transport'} bus routes`}>
            <span className="infra-stat-icon"><IconBus /></span>
            <strong>{review.infrastructure.busAvailability}</strong>
            <span>bus access</span>
          </a>
        )}
        {review.infrastructure.trainStations && review.infrastructure.trainStations.length > 0 && (
          <a className="infra-stat infra-stat-link" href={pt?.train ?? '#'} target="_blank" rel="noreferrer"
            title={`${pt?.label ?? 'Public transport'} train routes`}>
            <span className="infra-stat-icon"><IconTrain /></span>
            <strong>{review.infrastructure.trainStations.length}</strong>
            <span>train station{review.infrastructure.trainStations.length !== 1 ? 's' : ''}</span>
          </a>
        )}
        {review.infrastructure.tramStops && (
          <a className="infra-stat infra-stat-link" href={pt?.tram ?? pt?.train ?? '#'} target="_blank" rel="noreferrer"
            title={`${pt?.label ?? 'Public transport'} tram routes`}>
            <span className="infra-stat-icon"><IconTram /></span>
            <strong>Tram</strong>
            <span>access</span>
          </a>
        )}
        {totalSchools > 0 && (
          <div className="infra-stat">
            <span className="infra-stat-icon"><IconSchool /></span>
            <strong>{totalSchools}</strong>
            <span>school{totalSchools !== 1 ? 's' : ''}</span>
            {review.infrastructure.primarySchools != null && review.infrastructure.secondarySchools != null && (
              <span className="infra-stat-sublabel">
                {review.infrastructure.primarySchools} primary · {review.infrastructure.secondarySchools} secondary
              </span>
            )}
          </div>
        )}
        {review.infrastructure.shoppingPrecincts != null && review.infrastructure.shoppingPrecincts > 0 && (
          <div className="infra-stat">
            <span className="infra-stat-icon"><IconShopping /></span>
            <strong>{review.infrastructure.shoppingPrecincts}</strong>
            <span>shopping precinct{review.infrastructure.shoppingPrecincts !== 1 ? 's' : ''}</span>
          </div>
        )}
        {review.infrastructure.parks != null && review.infrastructure.parks > 0 && (
          <div className="infra-stat">
            <span className="infra-stat-icon"><IconPark /></span>
            <strong>{review.infrastructure.parks}</strong>
            <span>park{review.infrastructure.parks !== 1 ? 's' : ''}</span>
          </div>
        )}
        {review.infrastructure.medicalCentres != null && review.infrastructure.medicalCentres > 0 && (
          <div className="infra-stat">
            <span className="infra-stat-icon"><IconMedical /></span>
            <strong>{review.infrastructure.medicalCentres}</strong>
            <span>medical centre{review.infrastructure.medicalCentres !== 1 ? 's' : ''}</span>
          </div>
        )}
        {review.infrastructure.pointsOfInterest?.map((poi) => (
          <div key={poi.label} className="infra-stat">
            <span className="infra-stat-icon"><IconPoi /></span>
            <strong className="infra-stat-poi-label">{poi.label}</strong>
          </div>
        ))}
      </div>

      {review.infrastructure.trainStations && review.infrastructure.trainStations.length > 0 && (
        <div className="infra-station-list infra-station-list-inline">
          {review.infrastructure.trainStations.map((st) => (
            <div key={st.name} className="infra-station-row">
              <span className="infra-station-name"><IconTrain /> {st.name}</span>
              <span className="infra-station-lines">{st.lines}{st.distanceKm != null ? ` · ${st.distanceKm}km` : ''}</span>
            </div>
          ))}
          {review.infrastructure.tramStops && (
            <div className="infra-station-row">
              <span className="infra-station-name"><IconTram /> Tram stops</span>
              <span className="infra-station-lines">{review.infrastructure.tramStops}</span>
            </div>
          )}
        </div>
      )}

      {review.infrastructure.majorRoads && review.infrastructure.majorRoads.length > 0 && (
        <div className="infra-card">
          <h3>Major Roads &amp; Freeways</h3>
          <ul className="infra-roads-list">
            {review.infrastructure.majorRoads.map((road) => (
              <li key={road}>{road}</li>
            ))}
          </ul>
        </div>
      )}

      {(review.infrastructure.transit || review.infrastructure.education || review.infrastructure.lifestyle) && (
        <div className="infra-narrative-grid">
          {review.infrastructure.transit && (
            <div className="infra-card">
              <h3>Transit &amp; Commute</h3>
              <p>{review.infrastructure.transit}</p>
            </div>
          )}
          {review.infrastructure.education && (
            <div className="infra-card">
              <h3>Education &amp; Catchments</h3>
              <p>{review.infrastructure.education}</p>
            </div>
          )}
          {review.infrastructure.lifestyle && (
            <div className="infra-card">
              <h3>Lifestyle &amp; Amenities</h3>
              <p>{review.infrastructure.lifestyle}</p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

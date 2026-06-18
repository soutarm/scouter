import type { AustralianState, Review } from '../../types'
import { STATE_CBD, STATE_PT_URLS, haversineKm } from '../../services/location'

type Props = { review: Review }

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
            title={`Straight-line distance to ${cbd?.name ?? 'CBD'} — open in Google Maps`}>
            <span className="infra-stat-icon">📍</span>
            <strong>{straightLineKm} km</strong>
            <span>to {cbd?.name ?? 'CBD'}</span>
            <span className="infra-stat-sublabel">straight-line</span>
          </a>
        )}
        {review.infrastructure.cbdCommuteMinutes != null && (
          <div className="infra-stat">
            <span className="infra-stat-icon">⏱</span>
            <strong>{review.infrastructure.cbdCommuteMinutes} min</strong>
            <span>est. commute</span>
          </div>
        )}
        {review.infrastructure.busAvailability && (
          <a className="infra-stat infra-stat-link" href={pt?.bus ?? pt?.train ?? '#'} target="_blank" rel="noreferrer"
            title={`${pt?.label ?? 'Public transport'} bus routes`}>
            <span className="infra-stat-icon">🚌</span>
            <strong>{review.infrastructure.busAvailability}</strong>
            <span>bus access</span>
          </a>
        )}
        {review.infrastructure.trainStations && review.infrastructure.trainStations.length > 0 && (
          <a className="infra-stat infra-stat-link" href={pt?.train ?? '#'} target="_blank" rel="noreferrer"
            title={`${pt?.label ?? 'Public transport'} train routes`}>
            <span className="infra-stat-icon">🚉</span>
            <strong>{review.infrastructure.trainStations.length}</strong>
            <span>train station{review.infrastructure.trainStations.length !== 1 ? 's' : ''}</span>
          </a>
        )}
        {review.infrastructure.tramStops && (
          <a className="infra-stat infra-stat-link" href={pt?.tram ?? pt?.train ?? '#'} target="_blank" rel="noreferrer"
            title={`${pt?.label ?? 'Public transport'} tram routes`}>
            <span className="infra-stat-icon">🚋</span>
            <strong>Tram</strong>
            <span>access</span>
          </a>
        )}
        {totalSchools > 0 && (
          <div className="infra-stat">
            <span className="infra-stat-icon">🏫</span>
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
            <span className="infra-stat-icon">🛍</span>
            <strong>{review.infrastructure.shoppingPrecincts}</strong>
            <span>shopping precinct{review.infrastructure.shoppingPrecincts !== 1 ? 's' : ''}</span>
          </div>
        )}
        {review.infrastructure.parks != null && review.infrastructure.parks > 0 && (
          <div className="infra-stat">
            <span className="infra-stat-icon">🌳</span>
            <strong>{review.infrastructure.parks}</strong>
            <span>park{review.infrastructure.parks !== 1 ? 's' : ''}</span>
          </div>
        )}
        {review.infrastructure.medicalCentres != null && review.infrastructure.medicalCentres > 0 && (
          <div className="infra-stat">
            <span className="infra-stat-icon">🏥</span>
            <strong>{review.infrastructure.medicalCentres}</strong>
            <span>medical centre{review.infrastructure.medicalCentres !== 1 ? 's' : ''}</span>
          </div>
        )}
        {review.infrastructure.pointsOfInterest?.map((poi) => (
          <div key={poi.label} className="infra-stat">
            <span className="infra-stat-icon">{poi.icon}</span>
            <strong className="infra-stat-poi-label">{poi.label}</strong>
          </div>
        ))}
      </div>

      {review.infrastructure.trainStations && review.infrastructure.trainStations.length > 0 && (
        <div className="infra-station-list infra-station-list-inline">
          {review.infrastructure.trainStations.map((st) => (
            <div key={st.name} className="infra-station-row">
              <span className="infra-station-name">🚉 {st.name}</span>
              <span className="infra-station-lines">{st.lines}</span>
            </div>
          ))}
          {review.infrastructure.tramStops && (
            <div className="infra-station-row">
              <span className="infra-station-name">🚋 Tram stops</span>
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

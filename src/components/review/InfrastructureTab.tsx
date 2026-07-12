import type { AustralianState, Review } from '../../types'
import { STATE_CBD, haversineKm } from '../../services/location'

type Props = { review: Review }

// ---------------------------------------------------------------------------
// SVG icon set
// ---------------------------------------------------------------------------

const IconPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 21s6.3-5.6 6.3-11.1A6.3 6.3 0 0 0 5.7 9.9C5.7 15.4 12 21 12 21Z" />
    <circle cx="12" cy="9.9" r="2.2" />
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

const IconRoad = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 21 9 3M19 21 15 3M9 3h6M5 21h14" />
    <path d="M12 7v2M12 12v2M12 17v2" strokeDasharray="2 2" />
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
// Small helpers
// ---------------------------------------------------------------------------

const plural = (n: number, word: string) => `${n} ${word}${n !== 1 ? 's' : ''}`

interface GroupCardProps {
  icon: React.ReactNode
  count: string
  label?: string
  names?: string[]
  link?: string
  linkTitle?: string
  sublabel?: string
}

const GroupCard = ({ icon, count, label, names, link, linkTitle, sublabel }: GroupCardProps) => {
  const inner = (
    <>
      <div className="infra-group-card-header">
        <span className="infra-group-card-icon">{icon}</span>
        <div className="infra-group-card-meta">
          <strong className="infra-group-card-count">{count}</strong>
          {label && <span className="infra-group-card-label">{label}</span>}
          {sublabel && <span className="infra-group-card-sublabel">{sublabel}</span>}
        </div>
      </div>
      {names && names.length > 0 && (
        <ul className="infra-group-card-names">
          {names.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </>
  )

  if (link) {
    return (
      <a className="infra-group-card infra-group-card-link" href={link} target="_blank" rel="noreferrer" title={linkTitle}>
        {inner}
      </a>
    )
  }
  return <div className="infra-group-card">{inner}</div>
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const InfrastructureTab = ({ review }: Props) => {
  const stateKey = review.state.toUpperCase() as AustralianState
  const cbd = STATE_CBD[stateKey]
  const infra = review.infrastructure

  const straightLineKm =
    infra.suburbLat != null && infra.suburbLng != null && cbd
      ? Math.round(haversineKm(infra.suburbLat, infra.suburbLng, cbd.lat, cbd.lng) * 10) / 10
      : infra.cbdDistanceKm ?? null

  const mapsDirectionsUrl = cbd
    ? `https://www.google.com/maps/dir/${encodeURIComponent(`${review.suburb} ${review.state}`)}/${cbd.mapsQuery}`
    : null

  const totalSchools = (infra.primarySchools ?? 0) + (infra.secondarySchools ?? 0)
  const allSchoolNames = [
    ...(infra.primarySchoolNames ?? []),
    ...(infra.secondarySchoolNames ?? []),
  ].slice(0, 5)

  return (
    <section className="tab-panel infra-panel">

      {/* ── Transport ── */}
      <div className="infra-group">
        <h3 className="infra-group-heading">Transport</h3>
        <div className="infra-group-cards">
          {straightLineKm != null && (
            <GroupCard
              icon={<IconPin />}
              count={`Distance to ${cbd?.name ?? 'CBD'}`}
              names={[
                `📍 ${straightLineKm} km straight-line`,
                ...(infra.cbdCommuteMinutes != null ? [`🕐 ${infra.cbdCommuteMinutes} min est. commute`] : [])
              ]}
              link={mapsDirectionsUrl ?? undefined}
              linkTitle={`Open directions to ${cbd?.name ?? 'CBD'} in Google Maps`}
            />
          )}
          {(infra.trainStations?.length || infra.tramStops || infra.busAvailability) && (() => {
            const ptLines: string[] = []
            infra.trainStations?.forEach(s =>
              ptLines.push(`🚆 ${s.name}${s.distanceKm != null ? ` (${s.distanceKm}km)` : ''}`)
            )
            if (infra.tramStops) ptLines.push(`🚊 Tram - ${infra.tramStops}`)
            if (infra.busAvailability) ptLines.push(`🚌 Bus access - ${infra.busAvailability}`)
            return (
              <div className="infra-group-card">
                <div className="infra-group-card-header">
                  <span className="infra-group-card-icon infra-pt-icons">
                    {infra.trainStations?.length ? <IconTrain /> : null}
                    {infra.tramStops ? <IconTram /> : null}
                    {infra.busAvailability ? <IconBus /> : null}
                  </span>
                  <div className="infra-group-card-meta">
                    <strong className="infra-group-card-count">Public transport</strong>
                  </div>
                </div>
                <ul className="infra-group-card-names">
                  {ptLines.map(l => <li key={l}>{l}</li>)}
                </ul>
              </div>
            )
          })()}
          {infra.majorRoads && infra.majorRoads.length > 0 && (
            <GroupCard
              icon={<IconRoad />}
              count={plural(infra.majorRoads.length, 'major road')}
              label=""
              names={infra.majorRoads}
            />
          )}
        </div>
        {infra.transit && <p className="infra-group-narrative">{infra.transit}</p>}
      </div>

      {/* ── Services ── */}
      {(totalSchools > 0 || (infra.medicalCentres ?? 0) > 0 || (infra.shoppingPrecincts ?? 0) > 0) && (
        <div className="infra-group">
          <h3 className="infra-group-heading">Services</h3>
          <div className="infra-group-cards">
            {totalSchools > 0 && (
              <GroupCard
                icon={<IconSchool />}
                count={plural(totalSchools, 'school')}
                label=""
                sublabel={
                  infra.primarySchools != null && infra.secondarySchools != null
                    ? `${infra.primarySchools} primary · ${infra.secondarySchools} secondary`
                    : undefined
                }
                names={allSchoolNames}
              />
            )}
            {(infra.medicalCentres ?? 0) > 0 && (
              <GroupCard
                icon={<IconMedical />}
                count={plural(infra.medicalCentres!, 'medical centre')}
                label=""
                names={infra.medicalCentreNames}
              />
            )}
            {(infra.shoppingPrecincts ?? 0) > 0 && (
              <GroupCard
                icon={<IconShopping />}
                count={plural(infra.shoppingPrecincts!, 'shopping precinct')}
                label=""
                names={infra.shoppingPrecinctNames}
              />
            )}
          </div>
          {infra.education && <p className="infra-group-narrative">{infra.education}</p>}
        </div>
      )}

      {/* ── Green Space & Lifestyle ── */}
      {((infra.parks ?? 0) > 0 || (infra.restaurants ?? 0) > 0 || (infra.pointsOfInterest?.length ?? 0) > 0) && (
        <div className="infra-group">
          <h3 className="infra-group-heading">Green Space &amp; Lifestyle</h3>
          <div className="infra-group-cards">
            {(infra.parks ?? 0) > 0 && (
              <GroupCard
                icon={<IconPark />}
                count={plural(infra.parks!, 'park')}
                names={infra.parkNames}
              />
            )}
            {(infra.restaurants ?? 0) > 0 && (
              <GroupCard
                icon={<IconPoi />}
                count={plural(infra.restaurants!, 'restaurant')}
                names={infra.restaurantNames}
              />
            )}
            {infra.pointsOfInterest && infra.pointsOfInterest.length > 0 && (
              <GroupCard
                icon={<IconPoi />}
                count="Local highlights"
                names={infra.pointsOfInterest.map(p => {
                  // Guard against LLM returning a word instead of an emoji for icon
                  const isEmoji = p.icon && /\p{Emoji}/u.test(p.icon) && !/^[a-zA-Z]/.test(p.icon)
                  return isEmoji ? `${p.icon} ${p.label}` : p.label
                })}
              />
            )}
          </div>
          {infra.lifestyle && <p className="infra-group-narrative">{infra.lifestyle}</p>}
        </div>
      )}

    </section>
  )
}

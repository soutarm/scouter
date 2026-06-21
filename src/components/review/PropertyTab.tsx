import type { Review } from '../../types'
import logoRea from '/logo-rea.png'
import logoDomain from '/logo-domain.png'
import logoHomely from '/logo-homely.png'

const IconAllListings = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="7" height="7" rx="1.5" />
    <rect x="11" y="2" width="7" height="7" rx="1.5" />
    <rect x="2" y="11" width="7" height="7" rx="1.5" />
    <rect x="11" y="11" width="7" height="7" rx="1.5" />
  </svg>
)
const IconHouse = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5 10 3l7 6.5" />
    <path d="M5 8v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8" />
    <rect x="7.5" y="12" width="5" height="5" rx="0.5" />
  </svg>
)
const IconUnit = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="16" height="14" rx="2" />
    <path d="M2 8h16M10 3v14M6 11h1m6 0h1M6 14h1m6 0h1" />
  </svg>
)
const LogoRealEstate = () => <img src={logoRea} alt="realestate.com.au" className="listing-site-logo" />
const LogoDomain = () => <img src={logoDomain} alt="domain.com.au" className="listing-site-logo" />
const LogoHomely = () => <img src={logoHomely} alt="homely.com.au" className="listing-site-logo" />

type Props = { review: Review }

export const PropertyTab = ({ review }: Props) => {
  const slug = review.suburb.toLowerCase().replace(/\s+/g, '-')
  const slugPlus = review.suburb.toLowerCase().replace(/\s+/g, '+')
  const stateUp = review.state.toUpperCase()
  const stateLow = review.state.toLowerCase()
  const pc = review.postcode ?? ''

  const growthPeriodLabel = (() => {
    try {
      const d = new Date(review.generatedAt)
      if (isNaN(d.getTime())) return null
      return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })
    } catch { return null }
  })()
  const domainSlug = `${slug}-${stateLow}${pc ? `-${pc}` : ''}`
  const homelySlug = `${slug}-${stateLow}${pc ? `-${pc}` : ''}`
  const reaLocation = `${slugPlus},+${stateUp}${pc ? `+${pc}` : ''}`

  const listingSites = [
    {
      Logo: LogoRealEstate,
      links: [
        { href: `https://www.realestate.com.au/buy/in-${reaLocation}/list-1`, label: 'All listings', Icon: IconAllListings },
        { href: `https://www.realestate.com.au/buy/property-house-in-${reaLocation}/list-1`, label: 'Houses', Icon: IconHouse },
        { href: `https://www.realestate.com.au/buy/property-townhouse-in-${reaLocation}/list-1`, label: 'Townhouses', Icon: IconUnit },
      ],
    },
    {
      Logo: LogoDomain,
      links: [
        { href: `https://www.domain.com.au/sale/${domainSlug}/`, label: 'All listings', Icon: IconAllListings },
        { href: `https://www.domain.com.au/sale/${domainSlug}/house/`, label: 'Houses', Icon: IconHouse },
        { href: `https://www.domain.com.au/sale/${domainSlug}/town-house/`, label: 'Townhouses', Icon: IconUnit },
      ],
    },
    {
      Logo: LogoHomely,
      links: [
        { href: `https://www.homely.com.au/for-sale/${homelySlug}/real-estate`, label: 'All listings', Icon: IconAllListings },
        { href: `https://www.homely.com.au/for-sale/${homelySlug}/houses`, label: 'Houses', Icon: IconHouse },
        { href: `https://www.homely.com.au/for-sale/${homelySlug}/real-estate?propertytype=units,townhouses`, label: 'Units & Townhouses', Icon: IconUnit },
      ],
    },
  ]

  return (
    <section className="tab-panel">
      <h3>Property Market &amp; Rental Realities</h3>
      {review.marketNarrative && <p>{review.marketNarrative}</p>}
      {(review.stateMedianGrowth || review.capitalCityGrowth || review.stateMedianGrowth5yr || review.capitalCityGrowth5yr) && (
        <div className="state-benchmark-row">
          {review.stateMedianGrowth && (
            <div className="state-benchmark-pill">
              <span className="state-benchmark-label">{stateUp} state (12-month)</span>
              <span className="state-benchmark-value">{review.stateMedianGrowth}</span>
            </div>
          )}
          {review.capitalCityGrowth && (
            <div className="state-benchmark-pill">
              <span className="state-benchmark-label">Capital city (12-month)</span>
              <span className="state-benchmark-value">{review.capitalCityGrowth}</span>
            </div>
          )}
          {review.stateMedianGrowth5yr && (
            <div className="state-benchmark-pill">
              <span className="state-benchmark-label">{stateUp} state (5-year)</span>
              <span className="state-benchmark-value">{review.stateMedianGrowth5yr}</span>
            </div>
          )}
          {review.capitalCityGrowth5yr && (
            <div className="state-benchmark-pill">
              <span className="state-benchmark-label">Capital city (5-year)</span>
              <span className="state-benchmark-value">{review.capitalCityGrowth5yr}</span>
            </div>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Property Type</th>
              <th>Median Price</th>
              <th>12-Month Growth{growthPeriodLabel ? <><br /><span className="th-sub">to {growthPeriodLabel}</span></> : ''}</th>
              {review.marketRows.some((r) => r.fiveYearGrowth) && <th>5-Year Growth<br /><span className="th-sub">cumulative</span></th>}
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
                {review.marketRows.some((r) => r.fiveYearGrowth) && <td>{row.fiveYearGrowth ?? '-'}</td>}
                <td>{row.medianWeeklyRent}</td>
                <td>{row.grossYield}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="listing-links">
        <p className="eyebrow">Search listings</p>
        <div className="listing-link-grid">
          {listingSites.map(({ Logo, links }) => (
            <div key={Logo.name} className="listing-site-card">
              <Logo />
              <div className="listing-site-divider" aria-hidden="true" />
              <div className="listing-link-row">
                {links.map(({ href, label, Icon }) => (
                  <a key={label} href={href} target="_blank" rel="noreferrer" className="listing-link" aria-label={label} title={label}>
                    <Icon />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

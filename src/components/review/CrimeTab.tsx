import type { Review } from '../../types'
import { CrimeBar } from './CrimeBar'
import { EnvironmentalFactorPanel } from './EnvironmentalFactorPanel'

const NATURAL_RISK_ICONS: Record<string, string> = {
  'Bushfire':        '🔥',
  'Flood':           '🌊',
  'Storm/Hail':      '⛈',
  'Earthquake':      '🌍',
  'Coastal Erosion': '🏖',
  'Landslide':       '⛰',
}

type Props = { review: Review }

export const CrimeTab = ({ review }: Props) => (
  <section className="tab-panel safety-panel">
    {review.crime.narrative && (
      <div className="environment-section">
        <p className="eyebrow">Overview</p>
        <div className="safety-narrative">
          <p>{review.crime.narrative}</p>
        </div>
      </div>
    )}

    {(review.crime.crimeTypes?.length || review.crime.insuranceImpact || review.crime.estimatedAnnualPremiums) ? (
      <div className="environment-section">
        <p className="eyebrow">Crime &amp; Insurance</p>
        <div className="noise-panel">
          {review.crime.crimeTypes?.length ? (
            <div className="noise-rating-card">
              <div className="crime-chart-card noise-bars-card">
                <h3>Crime type levels</h3>
                <div className="crime-bars">
                  {review.crime.crimeTypes.map((ct) => (
                    <CrimeBar key={ct.label} label={ct.label} level={ct.level} />
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          {(review.crime.insuranceImpact || review.crime.estimatedAnnualPremiums) && (
            <div className="noise-factors safety-insurance-panel">
              <div className="noise-factor-row safety-insurance-summary">
                {review.crime.insuranceImpact && <p>{review.crime.insuranceImpact}</p>}
              </div>
              {review.crime.estimatedAnnualPremiums && (
                <>
                  {review.crime.estimatedAnnualPremiums.homeBuilding && (
                    <div className="noise-factor-row">
                      <span className="noise-factor-icon">🏠</span>
                      <div>
                        <span className="noise-factor-label">Home building</span>
                        <p className="noise-factor-value">{review.crime.estimatedAnnualPremiums.homeBuilding}</p>
                      </div>
                    </div>
                  )}
                  {review.crime.estimatedAnnualPremiums.homeContents && (
                    <div className="noise-factor-row">
                      <span className="noise-factor-icon">📦</span>
                      <div>
                        <span className="noise-factor-label">Home contents</span>
                        <p className="noise-factor-value">{review.crime.estimatedAnnualPremiums.homeContents}</p>
                      </div>
                    </div>
                  )}
                  {review.crime.estimatedAnnualPremiums.carComprehensive && (
                    <div className="noise-factor-row">
                      <span className="noise-factor-icon">🚗</span>
                      <div>
                        <span className="noise-factor-label">Car (comprehensive)</span>
                        <p className="noise-factor-value">{review.crime.estimatedAnnualPremiums.carComprehensive}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    ) : null}

    {review.crime.naturalRisks?.length ? (
      <EnvironmentalFactorPanel
        eyebrow="Natural Hazards"
        barsTitle="Natural hazard risks"
        bars={review.crime.naturalRisks.map((r) => ({ label: r.label, level: r.level }))}
        factors={review.crime.naturalRisks
          .filter((r) => r.note)
          .map((r) => ({
            icon: NATURAL_RISK_ICONS[r.label] ?? '⚠',
            label: r.label,
            value: r.note!,
          }))}
      />
    ) : null}
  </section>
)

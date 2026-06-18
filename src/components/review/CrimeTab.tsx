import type { Review } from '../../types'
import { CrimeBar } from './CrimeBar'

type Props = { review: Review }

export const CrimeTab = ({ review }: Props) => (
  <section className="tab-panel safety-panel">
    {review.crime.narrative && (
      <div className="safety-narrative">
        <h3>Crime &amp; Safety Analysis</h3>
        <p>{review.crime.narrative}</p>
      </div>
    )}
    {review.crime.crimeTypes?.length ? (
      <div className="crime-chart-card">
        <h3>Crime type levels</h3>
        <div className="crime-bars">
          {review.crime.crimeTypes.map((ct) => (
            <CrimeBar key={ct.label} label={ct.label} level={ct.level} />
          ))}
        </div>
      </div>
    ) : null}
    {(review.crime.insuranceImpact || review.crime.estimatedAnnualPremiums) && (
      <div className="insurance-card">
        <h3>Insurance &amp; Risk</h3>
        {review.crime.insuranceImpact && <p>{review.crime.insuranceImpact}</p>}
        {review.crime.estimatedAnnualPremiums && (
          <div className="insurance-premiums">
            {review.crime.estimatedAnnualPremiums.homeBuilding && (
              <div className="insurance-premium-item">
                <span>Home building</span>
                <strong>{review.crime.estimatedAnnualPremiums.homeBuilding}</strong>
              </div>
            )}
            {review.crime.estimatedAnnualPremiums.homeContents && (
              <div className="insurance-premium-item">
                <span>Home contents</span>
                <strong>{review.crime.estimatedAnnualPremiums.homeContents}</strong>
              </div>
            )}
            {review.crime.estimatedAnnualPremiums.carComprehensive && (
              <div className="insurance-premium-item">
                <span>Car (comprehensive)</span>
                <strong>{review.crime.estimatedAnnualPremiums.carComprehensive}</strong>
              </div>
            )}
          </div>
        )}
      </div>
    )}
  </section>
)

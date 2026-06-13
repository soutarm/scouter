import type { Review } from '../../types'
import { DemographicPieChart } from './DemographicPieChart'

type Props = { review: Review }

export const DemographicsTab = ({ review }: Props) => {
  const demographicSummary = review.demographics?.summary || review.infrastructure.demographic || ''
  const ageData = review.demographics?.ageGroups?.length
    ? review.demographics.ageGroups
    : review.demographics?.householdTypes

  return (
    <section className="tab-panel demographic-panel">
      <div className="demographic-copy">
        <p className="eyebrow">Resident profile</p>
        <h3>Demographic snapshot</h3>
        <p>{demographicSummary}</p>
        {/* Population stat — full width above Median Age */}
        {(review.demographics?.population || review.demographics?.medianAge) && (
          <div className="demographic-stats">
            {review.demographics?.population && (
              <div className="demographic-stats-pop">
                <span>Population</span>
                <strong>{review.demographics.population}</strong>
              </div>
            )}
            {review.demographics?.medianAge && (
              <div className="demographic-stats-age">
                <span>Median age</span>
                <strong>{review.demographics.medianAge}</strong>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Age profile */}
      {ageData?.length ? (
        <DemographicPieChart
          title={review.demographics?.ageGroups?.length ? 'Age profile' : 'Household mix'}
          data={ageData}
        />
      ) : null}

      {/* Who lives here — resident profiles */}
      {review.demographics?.residentProfiles?.length ? (
        <DemographicPieChart
          title="Who lives here"
          data={review.demographics.residentProfiles}
        />
      ) : null}

      {/* Housing tenure */}
      {review.demographics?.tenureTypes?.length ? (
        <DemographicPieChart title="Housing tenure" data={review.demographics.tenureTypes} />
      ) : null}

      {/* Country of origin */}
      {review.demographics?.countryOfOrigin?.length ? (
        <DemographicPieChart title="Country of origin" data={review.demographics.countryOfOrigin} />
      ) : null}
    </section>
  )
}

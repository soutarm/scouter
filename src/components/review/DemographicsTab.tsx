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
        {(review.demographics?.population || review.demographics?.medianAge) && (
          <div className="demographic-stats">
            {review.demographics?.population && (
              <div>
                <span>Population</span>
                <strong>{review.demographics.population}</strong>
              </div>
            )}
            {review.demographics?.medianAge && (
              <div>
                <span>Median age</span>
                <strong>{review.demographics.medianAge}</strong>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Charts — 2-column grid via CSS */}
      <div className="demographic-charts-grid">
        {ageData?.length ? (
          <DemographicPieChart
            title={review.demographics?.ageGroups?.length ? 'Age profile' : 'Household mix'}
            data={ageData}
          />
        ) : null}

        {review.demographics?.residentProfiles?.length ? (
          <DemographicPieChart
            title="Who lives here"
            data={review.demographics.residentProfiles}
          />
        ) : null}

        {review.demographics?.tenureTypes?.length ? (
          <DemographicPieChart title="Housing tenure" data={review.demographics.tenureTypes} />
        ) : null}

        {review.demographics?.countryOfOrigin?.length ? (
          <DemographicPieChart title="Country of origin" data={review.demographics.countryOfOrigin} />
        ) : null}
      </div>
    </section>
  )
}

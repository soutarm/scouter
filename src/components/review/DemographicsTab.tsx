import type { Review } from '../../types'
import { DemographicPieChart } from './DemographicPieChart'

type Props = { review: Review }

export const DemographicsTab = ({ review }: Props) => {
  const demographicSummary = review.demographics?.summary || review.infrastructure.demographic || ''
  const primaryDemographicData = review.demographics?.ageGroups?.length
    ? review.demographics.ageGroups
    : review.demographics?.householdTypes

  return (
    <section className="tab-panel demographic-panel">
      <div className="demographic-copy">
        <p className="eyebrow">Resident profile</p>
        <h3>Demographic snapshot</h3>
        <p>{demographicSummary}</p>
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
      </div>
      <DemographicPieChart
        title={review.demographics?.ageGroups?.length ? 'Age profile' : 'Household mix'}
        data={primaryDemographicData}
      />
      {review.demographics?.tenureTypes?.length ? (
        <DemographicPieChart title="Housing tenure" data={review.demographics.tenureTypes} />
      ) : null}
      {review.demographics?.countryOfOrigin?.length ? (
        <DemographicPieChart title="Country of origin" data={review.demographics.countryOfOrigin} />
      ) : null}
    </section>
  )
}

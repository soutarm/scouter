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
        {review.demographics?.population && (
          <div className="demographic-stats">
            <div>
              <span>Population</span>
              <strong>{review.demographics.population}</strong>
            </div>
          </div>
        )}
      </div>

      {/* Age profile — Median Age appears as footer stat inside this card */}
      {ageData?.length ? (
        <DemographicPieChart
          title={review.demographics?.ageGroups?.length ? 'Age profile' : 'Household mix'}
          data={ageData}
          footerStat={review.demographics?.medianAge
            ? { label: 'Median age', value: review.demographics.medianAge }
            : undefined}
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

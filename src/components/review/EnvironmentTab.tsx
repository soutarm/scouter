import type { Review } from '../../types'
import { ThermometerRange } from './ThermometerRange'
import { EnvironmentalFactorPanel } from './EnvironmentalFactorPanel'
import { WindRoseChart } from './WindRoseChart'

type Props = { review: Review }

export const EnvironmentTab = ({ review }: Props) => (
  <section className="tab-panel environment-panel">
    <div className="environment-section">
      <p className="eyebrow">Climate</p>
      <div className="climate-panel">
        <div className="climate-card">
          <h3>Summer Averages</h3>
          <ThermometerRange label="Summer min / max" description={review.climate.summerAverages} />
          <p>{review.climate.summerAverages}</p>
        </div>
        <div className="climate-card">
          <h3>Winter Averages</h3>
          <ThermometerRange label="Winter min / max" description={review.climate.winterAverages} />
          <p>{review.climate.winterAverages}</p>
        </div>
      </div>
    </div>

    {review.climate.airQuality && (
      <EnvironmentalFactorPanel
        eyebrow="Air Quality"
        barsTitle="Air quality by source"
        bars={[
          { label: 'Particulate matter', level: review.climate.airQuality.particulateMatterLevel ?? 'Low' },
          { label: 'Ozone', level: review.climate.airQuality.ozoneLevel ?? 'Low' },
          { label: 'Pollen', level: review.climate.airQuality.pollenLevel ?? 'Low' },
          { label: 'Industrial pollution', level: review.climate.airQuality.industrialPollutionLevel ?? 'Low' },
          { label: 'Overall', level: review.climate.airQuality.overallRating ?? 'Low' },
        ]}
        summary={review.climate.airQuality.overallSummary}
        factors={[
          { icon: '🌫', label: 'Particulate matter', value: review.climate.airQuality.particulateMatter },
          { icon: '🌤', label: 'Ozone', value: review.climate.airQuality.ozone },
          { icon: '🌿', label: 'Pollen', value: review.climate.airQuality.pollen },
          { icon: '🏭', label: 'Industrial pollution', value: review.climate.airQuality.industrialPollution },
        ]}
      />
    )}

    {review.climate.noise && (
      <EnvironmentalFactorPanel
        eyebrow="Noise & Amenity"
        barsTitle="Noise level by source"
        bars={[
          { label: 'Flight paths', level: review.climate.noise.flightPathLevel ?? 'Low' },
          { label: 'Rail noise', level: review.climate.noise.railNoiseLevel ?? 'Low' },
          { label: 'Road noise', level: review.climate.noise.roadNoiseLevel ?? 'Low' },
          { label: 'Industrial zones', level: review.climate.noise.industrialZonesLevel ?? 'Low' },
          { label: 'Overall', level: review.climate.noise.overallRating ?? 'Low' },
        ]}
        summary={review.climate.noise.overallSummary}
        factors={[
          { icon: '✈', label: 'Flight paths', value: review.climate.noise.flightPath },
          { icon: '🚆', label: 'Rail noise', value: review.climate.noise.railNoise },
          { icon: '🛣', label: 'Road noise', value: review.climate.noise.roadNoise },
          { icon: '🏭', label: 'Industrial zones', value: review.climate.noise.industrialZones },
        ]}
      />
    )}

    {review.climate.wind && (
      <div className="environment-section">
        <p className="eyebrow">Wind</p>
        <p className="environment-summary">{review.climate.wind.overallSummary}</p>
        <div className="wind-section">
          {review.climate.wind.directions?.length > 0 && (
            <WindRoseChart
              directions={review.climate.wind.directions}
              predominantDirection={review.climate.wind.predominantDirection}
              averageSpeedKmh={review.climate.wind.averageSpeedKmh}
            />
          )}
          <div className="wind-detail">
            <p className="wind-seasonal">{review.climate.wind.seasonalVariation}</p>
          </div>
        </div>
      </div>
    )}
  </section>
)

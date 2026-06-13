import type { Review } from '../../types'
import { toGoogleMapsUrl, toGoogleMapsEmbedUrl } from '../../services/location'

type Props = { review: Review }

export const MapTab = ({ review }: Props) => (
  <section className="tab-panel map-panel">
    <div className="map-copy">
      <div>
        <h3>Map location</h3>
        <p>Explore {review.suburb}, {review.state} in Google Maps.</p>
      </div>
      <a className="map-open-link" href={toGoogleMapsUrl(review)} target="_blank" rel="noreferrer">
        Open in Google Maps
      </a>
    </div>
    <div className="map-frame-wrap">
      <iframe
        title={`${review.suburb}, ${review.state} map`}
        src={toGoogleMapsEmbedUrl(review)}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    </div>
  </section>
)

import type { Review } from '../../types'
import { ScoreRing } from './ScoreRing'

type Props = {
  reviews: Review[]
  onDetails: (review: Review) => void
  onCategoryClick: (review: Review, tabKey: string) => void
}

export const ComparePanel = ({ reviews, onDetails, onCategoryClick }: Props) => (
  <section className="compare-panel" aria-label="Compare locations">
    <div className="compare-panel-header">
      <p className="eyebrow">Comparing {reviews.length} location{reviews.length !== 1 ? 's' : ''}</p>
      <h2>Side-by-side summary</h2>
    </div>
    <div className="compare-grid">
      {reviews.map((review) => (
        <div key={`${review.suburb}-${review.state}`} className="compare-card">
          {review.scores ? (
            <ScoreRing
              scores={review.scores}
              onCategoryClick={(tabKey) => onCategoryClick(review, tabKey)}
            />
          ) : (
            <div className="compare-card-fallback-score">
              <span className="compare-card-overall">–</span>
            </div>
          )}
          <div className="compare-card-body">
            <div className="compare-card-title">
              <p className="eyebrow">Summary</p>
              <h3>{review.suburb}, {review.state}</h3>
            </div>
            <p className="compare-card-summary">{review.summary}</p>
            <button
              type="button"
              className="summary-download primary-lite compare-details-btn"
              onClick={() => onDetails(review)}
            >
              Details
            </button>
          </div>
        </div>
      ))}
    </div>
  </section>
)

import { useState } from 'react'
import type { Review } from '../../types'
import { ScoreRing } from './ScoreRing'

type Props = {
  reviews: Review[]
  onDetails: (review: Review) => void
  onCategoryClick: (review: Review, tabKey: string) => void
}

export const ComparePanel = ({ reviews, onDetails, onCategoryClick }: Props) => {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <section className="compare-panel" aria-label="Compare locations">
      <div className="compare-panel-header">
        <div>
          <p className="eyebrow">Comparing {reviews.length} location{reviews.length !== 1 ? 's' : ''}</p>
          <h2>Location Comparison</h2>
          {collapsed && (
            <div className="compare-collapsed-names">
              {reviews.map((r, i) => (
                <span key={`${r.suburb}-${r.state}`} className="compare-collapsed-name">
                  {r.suburb}, {r.state}{i < reviews.length - 1 ? '' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="compare-collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand comparison' : 'Collapse comparison'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {collapsed
              ? <path d="M6 9l6 6 6-6" />
              : <path d="M6 15l6-6 6 6" />}
          </svg>
        </button>
      </div>

      {!collapsed && (
        <div className={`compare-grid${reviews.length === 4 ? ' compare-grid--4' : reviews.length >= 5 ? ' compare-grid--3col' : ''}`}>
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
      )}
    </section>
  )
}

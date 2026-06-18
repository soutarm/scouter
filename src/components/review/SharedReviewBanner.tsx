type Props = {
  onCreateOwn: () => void
}

export const SharedReviewBanner = ({ onCreateOwn }: Props) => (
  <section className="shared-review-banner" aria-label="Shared review">
    <div className="shared-review-banner-row">
      <p>You are viewing a shared Scouter review. Want to run your own search?</p>
      <button type="button" className="primary-lite" onClick={onCreateOwn}>
        Scout another location
      </button>
    </div>
  </section>
)

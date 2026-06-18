import type { ReviewSectionKey, ReviewScores } from '../../types'

type Props = {
  tabKey: ReviewSectionKey
  scores?: ReviewScores
  brief?: string
}

const SCORE_LABELS: Record<'property' | 'environment' | 'crime' | 'infrastructure', string> = {
  property: 'Property score',
  environment: 'Environment score',
  crime: 'Safety score',
  infrastructure: 'Infrastructure score',
}

const getTabScore = (tabKey: Props['tabKey'], scores?: ReviewScores): number | null => {
  if (!scores) return null
  if (tabKey === 'property') return scores.property
  if (tabKey === 'environment') return scores.environment
  if (tabKey === 'crime') return scores.safety
  if (tabKey === 'infrastructure') return scores.infrastructure
  if (tabKey === 'demographics') return null
  return null
}

const getScoreLabel = (tabKey: Props['tabKey']): string | null => {
  if (tabKey === 'property') return SCORE_LABELS.property
  if (tabKey === 'environment') return SCORE_LABELS.environment
  if (tabKey === 'crime') return SCORE_LABELS.crime
  if (tabKey === 'infrastructure') return SCORE_LABELS.infrastructure
  return null
}

const scoreColor = (score: number) => {
  if (score >= 8) return '#7fd49a'
  if (score >= 6) return '#a8c9a0'
  if (score >= 4) return '#d4a843'
  return '#c07060'
}

export const TabPageHeader = ({ tabKey, scores, brief }: Props) => {
  if (tabKey === 'map' || tabKey === 'demographics') return null
  const score = getTabScore(tabKey, scores)
  const scoreLabel = getScoreLabel(tabKey)
  const ringProgress = score != null ? Math.min(100, Math.max(0, (score / 10) * 100)) : 0
  const ringStyle = score != null
    ? { background: `conic-gradient(${scoreColor(score)} ${ringProgress}%, rgba(184, 204, 186, 0.44) ${ringProgress}% 100%)` }
    : undefined

  return (
    <section className="tab-page-header" aria-label="Section summary">
      {score != null && scoreLabel && (
        <div className="tab-page-score-chip">
          <span className="tab-page-score-ring" style={ringStyle} aria-hidden="true">
            <span className="tab-page-score-core">{score.toFixed(1)}</span>
          </span>
          <span className="tab-page-score-label">{scoreLabel}</span>
        </div>
      )}
      {brief ? <p className="tab-page-brief">{brief}</p> : null}
    </section>
  )
}

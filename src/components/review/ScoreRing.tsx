import { useEffect, useRef } from 'react'
import type { ReviewScores } from '../../types'

// ── Category config ──────────────────────────────────────────────────────────

const CATEGORIES: Array<{ key: keyof Omit<ReviewScores, 'overall'>; label: string }> = [
  { key: 'property',       label: 'Property' },
  { key: 'safety',         label: 'Safety' },
  { key: 'infrastructure', label: 'Infra' },
  { key: 'demographics',   label: 'People' },
  { key: 'environment',    label: 'Environ' },
]

// Score → colour: 8-10 bright mint, 6-7 sage, 4-5 amber, 1-3 coral
const scoreColour = (s: number) =>
  s >= 8 ? '#7fd49a' : s >= 6 ? '#a8c9a0' : s >= 4 ? '#d4a843' : '#c07060'

// ── Arc maths ────────────────────────────────────────────────────────────────

const R = 72          // circle radius
const STROKE = 11     // stroke width
const CIRCUMFERENCE = 2 * Math.PI * R

// The arc sweeps 270° (leaving a 90° gap at the bottom-centre)
const ARC_SWEEP = 0.75
const ARC_LENGTH = ARC_SWEEP * CIRCUMFERENCE   // total drawable arc length
const GAP_OFFSET_DEG = 135  // rotate so the gap sits at the bottom

// Standard "draw-on" technique:
//   dasharray  = "ARC_LENGTH  CIRCUMFERENCE"  (one dash of ARC_LENGTH, then invisible gap)
//   dashoffset = ARC_LENGTH - filledLength     (hides the tail of the dash)
//
// score 10/10  → filledLength = ARC_LENGTH  → offset = 0          (fully filled)
// score  0/10  → filledLength = 0           → offset = ARC_LENGTH (fully hidden)
const scoreToOffset = (score: number) =>
  ARC_LENGTH - (score / 10) * ARC_LENGTH

// ── Component ────────────────────────────────────────────────────────────────

type Props = { scores: ReviewScores; onCategoryClick?: (key: string) => void }

export const ScoreRing = ({ scores, onCategoryClick }: Props) => {
  const arcRef = useRef<SVGCircleElement>(null)
  const targetOffset = scoreToOffset(Math.max(1, Math.min(10, scores.overall)))

  // Animate the arc fill on mount / score change
  useEffect(() => {
    const el = arcRef.current
    if (!el) return
    // Start fully hidden (offset = ARC_LENGTH), animate to target
    el.style.transition = 'none'
    el.style.strokeDashoffset = String(ARC_LENGTH)
    // Force reflow so the starting state registers before the transition kicks in
    void el.getBoundingClientRect()
    el.style.transition = 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)'
    el.style.strokeDashoffset = String(targetOffset)
  }, [targetOffset])

  const size = (R + STROKE / 2 + 4) * 2
  const cx = size / 2
  const cy = size / 2
  const overallColour = scoreColour(scores.overall)

  return (
    <div className="score-ring-wrap">
      {/* SVG dial */}
      <div className="score-ring-dial-wrap" aria-label={`Overall score ${scores.overall} out of 10`}>
        <svg
          className="score-ring-svg"
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden="true"
        >
          {/* Track (background circle — always shows the full 270° arc) */}
          <circle
            cx={cx} cy={cy} r={R}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={STROKE}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${GAP_OFFSET_DEG} ${cx} ${cy})`}
          />
          {/* Fill arc — dashoffset reveals the correct proportion; animated via ref */}
          <circle
            ref={arcRef}
            cx={cx} cy={cy} r={R}
            fill="none"
            stroke={overallColour}
            strokeWidth={STROKE}
            strokeDasharray={`${ARC_LENGTH} ${CIRCUMFERENCE}`}
            strokeDashoffset={targetOffset}
            strokeLinecap="round"
            transform={`rotate(${GAP_OFFSET_DEG} ${cx} ${cy})`}
            style={{ filter: `drop-shadow(0 0 6px ${overallColour}88)` }}
          />
        </svg>

        {/* Centre label */}
        <div className="score-ring-centre">
          <span className="score-ring-number">{scores.overall}</span>
          <span className="score-ring-denom">/10</span>
          <span className="score-ring-label">Overall</span>
        </div>
      </div>

      {/* Category row */}
      <div className="score-ring-cats" role="list">
        {CATEGORIES.map(({ key, label }) => {
          const val = scores[key]
          const colour = scoreColour(val)
          return (
            <button
              key={key}
              type="button"
              className="score-ring-cat"
              role="listitem"
              onClick={() => onCategoryClick?.(key === 'safety' ? 'crime' : key === 'demographics' ? 'demographics' : key)}
              title={`${label}: ${val}/10`}
            >
              <svg className="score-ring-cat-arc" viewBox="0 0 36 36" aria-hidden="true">
                {/* Track */}
                <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4"
                  strokeDasharray={`${0.75 * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
                  strokeLinecap="round"
                  transform={`rotate(135 18 18)`}
                />
                {/* Fill */}
                <circle cx="18" cy="18" r="14" fill="none" stroke={colour} strokeWidth="4"
                  strokeDasharray={`${(val / 10) * 0.75 * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
                  strokeLinecap="round"
                  transform={`rotate(135 18 18)`}
                />
                <text x="18" y="22" textAnchor="middle" fontSize="11" fontWeight="800" fill="#f7fff2">{val}</text>
              </svg>
              <span className="score-ring-cat-label">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

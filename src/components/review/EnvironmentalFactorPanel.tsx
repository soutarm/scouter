import { CrimeBar } from './CrimeBar'

type Level = 'Low' | 'Medium' | 'High' | 'Very High'

type BarEntry = { label: string; level: Level }
type FactorEntry = { icon: string; label: string; value: string }

type Props = {
  eyebrow?: string
  barsTitle: string
  bars: BarEntry[]
  summary?: string
  factors: FactorEntry[]
}

export const EnvironmentalFactorPanel = ({ eyebrow, barsTitle, bars, summary, factors }: Props) => (
  <div className="environment-section">
    {eyebrow && <p className="eyebrow">{eyebrow}</p>}
    <div className="noise-panel">
      <div className="noise-rating-card">
        <div className="crime-chart-card noise-bars-card">
          <h3>{barsTitle}</h3>
          <div className="crime-bars">
            {bars.map(({ label, level }) => (
              <CrimeBar key={label} label={label} level={level} />
            ))}
          </div>
        </div>
        {summary && <p className="noise-summary">{summary}</p>}
      </div>
      <div className="noise-factors">
        {factors.map(({ icon, label, value }) => (
          <div key={label} className="noise-factor-row">
            <span className="noise-factor-icon">{icon}</span>
            <div>
              <span className="noise-factor-label">{label}</span>
              <p className="noise-factor-value">{value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
)

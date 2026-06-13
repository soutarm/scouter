export const CRIME_LEVEL_MAP = { Low: 1, Medium: 2, High: 3, 'Very High': 4 } as const
export const CRIME_LEVEL_COLORS: Record<string, string> = {
  Low: '#4f8f66',
  Medium: '#d4a843',
  High: '#c0703b',
  'Very High': '#b03020',
}

type Props = { label: string; level: 'Low' | 'Medium' | 'High' | 'Very High' }

export const CrimeBar = ({ label, level }: Props) => {
  const filled = CRIME_LEVEL_MAP[level]
  return (
    <div className="crime-bar-row">
      <span className="crime-bar-label">{label}</span>
      <div className="crime-bar-track" aria-label={`${label}: ${level}`}>
        {([1, 2, 3, 4] as const).map((step) => (
          <span
            key={step}
            className="crime-bar-segment"
            style={step <= filled ? { background: CRIME_LEVEL_COLORS[level] } : undefined}
            aria-hidden="true"
          />
        ))}
      </div>
      <span className="crime-bar-level" style={{ color: CRIME_LEVEL_COLORS[level] }}>{level}</span>
    </div>
  )
}

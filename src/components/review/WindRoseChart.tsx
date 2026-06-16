type WindDirection = {
  direction: 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
  frequency: number
  avgSpeedKmh: number
}

type Props = {
  directions: WindDirection[]
}

const DIRECTION_ANGLES: Record<string, number> = {
  N: -90, NE: -45, E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: -135,
}

// Map speed to a colour: calm (blue) → moderate (sage) → strong (amber) → gale (coral)
const speedColour = (kmh: number): string => {
  if (kmh < 15) return '#7ecfdb'
  if (kmh < 25) return '#7fd49a'
  if (kmh < 35) return '#d4a843'
  return '#c07060'
}

export const WindRoseChart = ({ directions }: Props) => {
  const cx = 80
  const cy = 80
  const maxRadius = 55
  const innerRadius = 8

  const maxFreq = Math.max(...directions.map((d) => d.frequency), 1)

  return (
    <div className="wind-rose-wrap">
      <svg
        className="wind-rose-svg"
        viewBox="0 0 160 160"
        aria-label="Wind rose diagram showing frequency and speed by direction"
        role="img"
      >
        {/* Concentric reference rings */}
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <circle
            key={frac}
            cx={cx} cy={cy}
            r={innerRadius + (maxRadius - innerRadius) * frac}
            fill="none"
            stroke="rgba(36,75,49,0.1)"
            strokeWidth="0.8"
          />
        ))}

        {/* Cross-hair axes */}
        {[0, 45, 90, 135].map((angleDeg) => {
          const rad = (angleDeg * Math.PI) / 180
          return (
            <line
              key={angleDeg}
              x1={cx - Math.cos(rad) * maxRadius}
              y1={cy - Math.sin(rad) * maxRadius}
              x2={cx + Math.cos(rad) * maxRadius}
              y2={cy + Math.sin(rad) * maxRadius}
              stroke="rgba(36,75,49,0.1)"
              strokeWidth="0.8"
            />
          )
        })}

        {/* Bars */}
        {directions.map(({ direction, frequency, avgSpeedKmh }) => {
          const angleDeg = DIRECTION_ANGLES[direction] ?? 0
          const rad = (angleDeg * Math.PI) / 180
          const barLen = innerRadius + (maxRadius - innerRadius) * (frequency / maxFreq)
          const barWidth = 10
          const x = cx + Math.cos(rad) * (innerRadius + (barLen - innerRadius) / 2)
          const y = cy + Math.sin(rad) * (innerRadius + (barLen - innerRadius) / 2)
          return (
            <rect
              key={direction}
              x={x - barWidth / 2}
              y={y - (barLen - innerRadius) / 2}
              width={barWidth}
              height={barLen - innerRadius}
              rx="3"
              fill={speedColour(avgSpeedKmh)}
              opacity="0.85"
              transform={`rotate(${angleDeg + 90}, ${x}, ${y})`}
            >
              <title>{direction}: {frequency}% frequency, avg {avgSpeedKmh} km/h</title>
            </rect>
          )
        })}

        {/* Centre dot */}
        <circle cx={cx} cy={cy} r={innerRadius} fill="rgba(255,255,255,0.9)" stroke="rgba(36,75,49,0.2)" strokeWidth="1" />

        {/* Cardinal labels */}
        {(['N', 'E', 'S', 'W'] as const).map((dir) => {
          const rad = ((DIRECTION_ANGLES[dir] ?? 0) * Math.PI) / 180
          const labelR = maxRadius + 10
          return (
            <text
              key={dir}
              x={cx + Math.cos(rad) * labelR}
              y={cy + Math.sin(rad) * labelR}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="9"
              fontWeight="800"
              fill="#244b31"
            >
              {dir}
            </text>
          )
        })}
      </svg>

      {/* Horizontal colour key below diagram */}
      <div className="wind-rose-speed-key">
        {[
          { label: '< 15 km/h', colour: '#7ecfdb' },
          { label: '15–25',     colour: '#7fd49a' },
          { label: '25–35',     colour: '#d4a843' },
          { label: '35+',       colour: '#c07060' },
        ].map(({ label, colour }) => (
          <span key={label} className="wind-rose-key-item">
            <span className="wind-rose-key-dot" style={{ background: colour }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

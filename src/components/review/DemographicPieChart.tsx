import type { DemographicDatum } from '../../types'

const DEMOGRAPHIC_COLORS = ['#244b31', '#4f8f66', '#9fd7a8', '#d4e9a6', '#f1c96b', '#d9835f']

const normalizeDemographicData = (data: DemographicDatum[] | undefined) => {
  const cleanData = (data ?? []).filter((item) => item.label && Number.isFinite(item.value) && item.value > 0)
  const total = cleanData.reduce((sum, item) => sum + item.value, 0)
  if (!total) return []
  return cleanData.map((item, index) => ({
    ...item,
    color: DEMOGRAPHIC_COLORS[index % DEMOGRAPHIC_COLORS.length],
    percent: (item.value / total) * 100,
  }))
}

type Props = { title: string; data: DemographicDatum[] | undefined; footerStat?: { label: string; value: string } }

export const DemographicPieChart = ({ title, data, footerStat }: Props) => {
  const segments = normalizeDemographicData(data)

  if (!segments.length) {
    return (
      <div className="demographic-chart-card">
        <h3>{title}</h3>
        <p className="demographic-empty">Pie chart data unavailable.</p>
      </div>
    )
  }

  const gradient = segments
    .reduce<{ stops: string[]; cursor: number }>(
      (acc, segment) => {
        const start = acc.cursor
        const end = acc.cursor + segment.percent
        return { stops: [...acc.stops, `${segment.color} ${start}% ${end}%`], cursor: end }
      },
      { stops: [], cursor: 0 },
    )
    .stops.join(', ')

  return (
    <div className="demographic-chart-card">
      <h3>{title}</h3>
      <div className="demographic-chart-layout">
        <div
          className="demographic-pie"
          style={{ '--demographic-gradient': `conic-gradient(${gradient})` } as React.CSSProperties}
          role="img"
          aria-label={`${title}: ${segments.map((s) => `${s.label} ${Math.round(s.percent)}%`).join(', ')}`}
        />
        <ul className="demographic-legend">
          {segments.map((segment) => (
            <li key={segment.label}>
              <span className="demographic-swatch" style={{ background: segment.color }} aria-hidden="true" />
              <span>{segment.label}</span>
              <strong>{Math.round(segment.percent)}%</strong>
            </li>
          ))}
        </ul>
      </div>
      {footerStat && (
        <div className="demographic-chart-footer-stat">
          <span>{footerStat.label}</span>
          <strong>{footerStat.value}</strong>
        </div>
      )}
    </div>
  )
}

const CLIMATE_SCALE_MIN = -10
const CLIMATE_SCALE_MAX = 50

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const formatTemperature = (value: number) => `${Math.round(value)}°C`

const collectTemperatures = (text: string) => {
  const temperatures: number[] = []
  let textWithoutRanges = text
  textWithoutRanges = textWithoutRanges.replace(
    /(^|[^\d.])(-?\d+(?:\.\d+)?)\s*(?:°\s*)?(?:c\b)?\s*(?:-|–|—|to)\s*(-?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b/gi,
    (match, prefix: string, low: string, high: string) => {
      temperatures.push(Number.parseFloat(low), Number.parseFloat(high))
      return prefix.padEnd(match.length, ' ')
    },
  )
  temperatures.push(
    ...[...textWithoutRanges.matchAll(/(^|[^\d.])(-?\d+(?:\.\d+)?)\s*(?:°\s*)?c\b/gi)].map((match) =>
      Number.parseFloat(match[2]),
    ),
  )
  return temperatures
}

const extractTemperatureProfile = (description: string) => {
  const sentences = description.split(/(?<=[.!?])\s+/).filter(Boolean)
  const averageTemperatures: number[] = []
  const peakTemperatures: number[] = []
  sentences.forEach((sentence) => {
    const temperatures = collectTemperatures(sentence)
    if (!temperatures.length) return
    if (/heat\s*wave|heatwave|peak|extreme|record|above|push/i.test(sentence)) {
      peakTemperatures.push(...temperatures)
      return
    }
    averageTemperatures.push(...temperatures)
  })
  const fallbackTemperatures = averageTemperatures.length ? averageTemperatures : collectTemperatures(description)
  const peak = peakTemperatures.length ? Math.max(...peakTemperatures) : undefined
  if (!fallbackTemperatures.length) return peak ? { min: peak, max: peak, peak } : null
  return {
    min: Math.min(...fallbackTemperatures),
    max: Math.max(...fallbackTemperatures),
    peak: peak && peak > Math.max(...fallbackTemperatures) ? peak : undefined,
  }
}

const temperaturePosition = (value: number) =>
  ((clampNumber(value, CLIMATE_SCALE_MIN, CLIMATE_SCALE_MAX) - CLIMATE_SCALE_MIN) /
    (CLIMATE_SCALE_MAX - CLIMATE_SCALE_MIN)) * 100

type Props = { label: string; description: string }

export const ThermometerRange = ({ label, description }: Props) => {
  const profile = extractTemperatureProfile(description)
  if (!profile) {
    return (
      <div className="thermometer-card">
        <p className="thermometer-label">{label}</p>
        <p className="thermometer-empty">Temperature range unavailable</p>
      </div>
    )
  }
  const minPosition = temperaturePosition(profile.min)
  const maxPosition = temperaturePosition(profile.max)
  const peakPosition = profile.peak ? temperaturePosition(profile.peak) : null
  return (
    <div className="thermometer-card" aria-label={`${label} temperature range`}>
      <div className="thermometer-header">
        <p className="thermometer-label">{label}</p>
        <p>
          <span>{formatTemperature(profile.min)}</span>
          <span>{formatTemperature(profile.max)}</span>
          {profile.peak ? <span>HW {formatTemperature(profile.peak)}</span> : null}
        </p>
      </div>
      <div className="thermometer-track" aria-hidden="true">
        <span className="thermometer-fill" style={{ left: `${minPosition}%`, width: `${Math.max(maxPosition - minPosition, 2)}%` }} />
        <span className="thermometer-marker min" style={{ left: `${minPosition}%` }} />
        <span className="thermometer-marker max" style={{ left: `${maxPosition}%` }} />
        {peakPosition !== null ? <span className="thermometer-marker peak" style={{ left: `${peakPosition}%` }} /> : null}
      </div>
      <div className="thermometer-scale" aria-hidden="true">
        <span>{formatTemperature(CLIMATE_SCALE_MIN)}</span>
        {profile.peak && peakPosition !== null ? <span className="thermometer-peak-label" style={{ left: `${peakPosition}%` }}>HW</span> : null}
        <span>{formatTemperature(CLIMATE_SCALE_MAX)}</span>
      </div>
    </div>
  )
}

// Crossfading category icon display for the busy/loading state.
// Each icon corresponds to one busy message by index. Reuses the same path
// data as the main app's tab icons so the loading state doesn't drift from
// the rest of the UI's iconography.

import { demographicsPaths, environmentPaths, infrastructurePaths, mapPaths, propertyPaths, safetyPaths } from './tabIconPaths'

type Props = { activeIndex: number }

type IconDef = { label: string; paths: React.ReactNode }

const ICONS: IconDef[] = [
  { label: 'Scouting', paths: mapPaths },             // 0 - Scouting location
  { label: 'Infrastructure', paths: infrastructurePaths }, // 1 - Infrastructure
  { label: 'Transport', paths: propertyPaths },        // 2 - Transport / transit links
  { label: 'Environment', paths: environmentPaths },   // 3 - Climate & noise
  { label: 'Market', paths: demographicsPaths },       // 4 - Market momentum
  { label: 'Safety', paths: safetyPaths },             // 5 - Crime investigation
  { label: 'Safety check', paths: safetyPaths },       // 6 - Cross-checking safety signals
]

const svgBaseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
}

export const BusyIconMorph = ({ activeIndex }: Props) => {
  const safeIndex = activeIndex % ICONS.length

  return (
    <div className="busy-icon-morph" aria-hidden="true">
      {ICONS.map((icon, i) => (
        <svg
          key={icon.label}
          {...svgBaseProps}
          className={`busy-icon-slide${i === safeIndex ? ' busy-icon-slide--active' : ''}`}
        >
          {icon.paths}
        </svg>
      ))}
    </div>
  )
}

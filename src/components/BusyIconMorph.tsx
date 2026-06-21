// Crossfading category icon display for the busy/loading state.
// Each icon corresponds to one busy message by index.

type Props = { activeIndex: number }

type IconDef = { label: string; paths: React.ReactNode }

const ICONS: IconDef[] = [
  {
    // 0 - Scouting location (map / pin)
    label: 'Scouting',
    paths: (
      <>
        <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21" />
        <line x1="9" y1="3" x2="9" y2="18" />
        <line x1="15" y1="6" x2="15" y2="21" />
      </>
    ),
  },
  {
    // 1 - Infrastructure
    label: 'Infrastructure',
    paths: (
      <>
        <rect x="5" y="3" width="14" height="13" rx="3" />
        <path d="M5 11h14" />
        <circle cx="8.5" cy="16.5" r="1.5" />
        <circle cx="15.5" cy="16.5" r="1.5" />
        <path d="M8.5 18l-2 3M15.5 18l2 3" />
        <path d="M9 7h2M13 7h2" />
      </>
    ),
  },
  {
    // 2 - Transport / transit links (property / home)
    label: 'Transport',
    paths: (
      <>
        <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
        <path d="M9 21V12h6v9" />
      </>
    ),
  },
  {
    // 3 - Climate & noise (environment)
    label: 'Environment',
    paths: (
      <>
        <circle cx="12" cy="10" r="2" />
        <path d="M12 8c0-2-1.5-4-1.5-4S9 6 9 8M12 8c0-2 1.5-4 1.5-4S15 6 15 8M12 12c0 2-1.5 4-1.5 4S9 14 9 12M12 12c0 2 1.5 4 1.5 4S15 14 15 12M10 10c-2 0-4-1.5-4-1.5S8 7 10 10M14 10c2 0 4-1.5 4-1.5S14 7 14 10M10 10c-2 0-4 1.5-4 1.5S8 13 10 10M14 10c2 0 4 1.5 4 1.5S14 13 14 10" />
        <path d="M12 16v6" />
      </>
    ),
  },
  {
    // 4 - Market momentum (property again but distinct feel - use demographics)
    label: 'Market',
    paths: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    // 5 - Crime investigation
    label: 'Safety',
    paths: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </>
    ),
  },
  {
    // 6 - Cross-checking safety signals (shield again - wrap gracefully)
    label: 'Safety check',
    paths: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
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

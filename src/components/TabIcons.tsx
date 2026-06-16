const svgProps = {
  xmlns: 'http://www.w3.org/2000/svg', width: 20, height: 20,
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const PropertyIcon     = () => <svg {...svgProps}><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
export const SafetyIcon       = () => <svg {...svgProps}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
export const InfrastructureIcon = () => <svg {...svgProps}><rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 11h14"/><circle cx="8.5" cy="16.5" r="1.5"/><circle cx="15.5" cy="16.5" r="1.5"/><path d="M8.5 18l-2 3M15.5 18l2 3"/><path d="M9 7h2M13 7h2"/></svg>
export const DemographicsIcon = () => <svg {...svgProps}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
export const EnvironmentIcon  = () => <svg {...svgProps}><path d="M12 22v-6"/><path d="M12 16c0 0-7-2-7-8a7 7 0 0 1 14 0c0 6-7 8-7 8z"/></svg>
export const MapIcon          = () => <svg {...svgProps}><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>

import { demographicsPaths, environmentPaths, infrastructurePaths, mapPaths, propertyPaths, safetyPaths } from './tabIconPaths'

const svgProps = {
  xmlns: 'http://www.w3.org/2000/svg', width: 20, height: 20,
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

export const PropertyIcon       = () => <svg {...svgProps}>{propertyPaths}</svg>
export const SafetyIcon         = () => <svg {...svgProps}>{safetyPaths}</svg>
export const InfrastructureIcon = () => <svg {...svgProps}>{infrastructurePaths}</svg>
export const DemographicsIcon   = () => <svg {...svgProps}>{demographicsPaths}</svg>
export const EnvironmentIcon    = () => <svg {...svgProps}>{environmentPaths}</svg>
export const MapIcon            = () => <svg {...svgProps}>{mapPaths}</svg>

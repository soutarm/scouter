import { australianStates } from '../types'
import type { AustralianState, Review } from '../types'

export const STATE_NAME_MAP: Record<string, AustralianState> = {
  'australian capital territory': 'ACT',
  'new south wales': 'NSW',
  'northern territory': 'NT',
  'queensland': 'QLD',
  'south australia': 'SA',
  'tasmania': 'TAS',
  'victoria': 'VIC',
  'western australia': 'WA',
}

export const STATE_CBD: Record<AustralianState, { lat: number; lng: number; name: string; mapsQuery: string }> = {
  ACT: { lat: -35.2809, lng: 149.1300, name: 'Canberra City', mapsQuery: 'Civic+ACT+2601' },
  NSW: { lat: -33.8688, lng: 151.2093, name: 'Sydney CBD', mapsQuery: 'Sydney+CBD+NSW+2000' },
  NT:  { lat: -12.4634, lng: 130.8456, name: 'Darwin CBD', mapsQuery: 'Darwin+CBD+NT+0800' },
  QLD: { lat: -27.4705, lng: 153.0260, name: 'Brisbane CBD', mapsQuery: 'Brisbane+CBD+QLD+4000' },
  SA:  { lat: -34.9285, lng: 138.6007, name: 'Adelaide CBD', mapsQuery: 'Adelaide+CBD+SA+5000' },
  TAS: { lat: -42.8821, lng: 147.3272, name: 'Hobart CBD', mapsQuery: 'Hobart+CBD+TAS+7000' },
  VIC: { lat: -37.8136, lng: 144.9631, name: 'Melbourne CBD', mapsQuery: 'Melbourne+CBD+VIC+3000' },
  WA:  { lat: -31.9505, lng: 115.8605, name: 'Perth CBD', mapsQuery: 'Perth+CBD+WA+6000' },
}

export const STATE_PT_URLS: Record<AustralianState, { train?: string; tram?: string; bus?: string; label: string }> = {
  ACT: { bus: 'https://www.transport.act.gov.au/getting-around/by-bus', label: 'Transport Canberra' },
  NSW: { train: 'https://transportnsw.info/routes/train', bus: 'https://transportnsw.info/routes/bus', label: 'Transport NSW' },
  NT:  { bus: 'https://nt.gov.au/driving/buses-and-public-transport', label: 'NT Public Transport' },
  QLD: { train: 'https://translink.com.au/plan-your-journey/maps/rail-network-map', bus: 'https://translink.com.au', label: 'TransLink' },
  SA:  { train: 'https://www.adelaidemetro.com.au/routes-and-maps/trains', tram: 'https://www.adelaidemetro.com.au/routes-and-maps/trams', bus: 'https://www.adelaidemetro.com.au/routes-and-maps/buses', label: 'Adelaide Metro' },
  TAS: { bus: 'https://www.metrotas.com.au/timetables/', label: 'Metro Tasmania' },
  VIC: { train: 'https://ptv.vic.gov.au/routes/train/', tram: 'https://ptv.vic.gov.au/routes/tram/', bus: 'https://ptv.vic.gov.au/routes/bus/', label: 'PTV' },
  WA:  { train: 'https://www.transperth.wa.gov.au/Timetables/Train-Timetables', bus: 'https://www.transperth.wa.gov.au/Timetables/Bus-Timetables', label: 'Transperth' },
}

export const featuredQuickLocations = [
  'Canberra, ACT',
  'Sydney, NSW',
  'Darwin, NT',
  'Brisbane, QLD',
  'Adelaide, SA',
  'Hobart, TAS',
  'Melbourne, VIC',
  'Perth, WA',
] as const

export const mapStateName = (name: string): AustralianState | undefined =>
  STATE_NAME_MAP[name.toLowerCase().trim()]

export const isAustralianState = (value: string | null | undefined): value is AustralianState =>
  australianStates.includes((value ?? '').toUpperCase() as AustralianState)

export const splitLocation = (value: string) => {
  const trimmed = value.trim()
  const match = trimmed.match(/^(.*?),\s*(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/i)
  if (!match) return { place: trimmed, state: undefined }
  return {
    place: (match[1] ?? '').trim(),
    state: (match[2] ?? '').toUpperCase() as AustralianState,
  }
}

/** Pure parser — accepts a query string directly, making it testable without window. */
export const parseSearchParams = (qs: string) => {
  const params = new URLSearchParams(qs)
  const rawSearch = (params.get('search') ?? '').trim()
  const rawState = params.get('state')
  const rawTab = params.get('tab') ?? undefined
  if (!rawSearch) return null
  const parsed = splitLocation(rawSearch)
  return {
    place: parsed.place,
    state: isAustralianState(rawState) ? rawState.toUpperCase() as AustralianState : parsed.state,
    tab: rawTab,
  }
}

export const readSearchFromQueryString = () => parseSearchParams(window.location.search)

export const writeSearchToQueryString = (place: string, state: AustralianState, tab?: string) => {
  const params = new URLSearchParams(window.location.search)
  params.set('search', place)
  params.set('state', state)
  if (tab) params.set('tab', tab)
  else params.delete('tab')
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}${window.location.hash}`)
}

export const toSearchHref = (search: string, fallbackState: AustralianState) => {
  const parsed = splitLocation(search)
  const state = parsed.state ?? fallbackState
  const params = new URLSearchParams(window.location.search)
  params.set('search', parsed.place)
  params.set('state', state)
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`
}

export const getSuggestedLocation = (review: Review | null) => {
  const suggestedSuburb = review?.suggestedSuburb?.trim()
  const suggestedState = review?.suggestedState?.trim().toUpperCase()
  if (!suggestedSuburb || !isAustralianState(suggestedState)) return null
  return { place: suggestedSuburb, state: suggestedState, label: `${suggestedSuburb}, ${suggestedState}` }
}

export const toMapQuery = (review: Review) => `${review.suburb}, ${review.state}, Australia`

export const toGoogleMapsEmbedUrl = (review: Review) =>
  `https://www.google.com/maps?q=${encodeURIComponent(toMapQuery(review))}&output=embed`

export const toGoogleMapsUrl = (review: Review) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(toMapQuery(review))}`

// Haversine straight-line distance in km
export const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

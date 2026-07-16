/**
 * OSM grounding data service.
 *
 * Fetches real infrastructure facts for a suburb from:
 *   1. Nominatim (OSM geocoder) - suburb bounding box + centre point
 *   2. Overpass API            - roads, transit, schools, parks, shops, medical
 *
 * Both APIs are free with no API key. Results are formatted as a compact
 * text block for injection into the LLM prompt as grounding context.
 */

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const OVERPASS_URL  = 'https://overpass-api.de/api/interpreter'
const TIMEOUT_MS    = 12_000

type NominatimResult = {
  lat: string
  lon: string
  boundingbox: [string, string, string, string] // [minLat, maxLat, minLon, maxLon]
  display_name: string
}

type OverpassElement = {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number   // present on nodes (out body)
  lon?: number   // present on nodes (out body)
  center?: { lat: number; lon: number }  // present on ways/relations (out center body)
  tags?: Record<string, string>
}

type OverpassResponse = {
  elements: OverpassElement[]
}

// Parse Nominatim bbox [minLat, maxLat, minLon, maxLon] into [s, w, n, e]
const parseBbox = (bbox: [string, string, string, string]): [number, number, number, number] => [
  parseFloat(bbox[0]), // s (minLat)
  parseFloat(bbox[2]), // w (minLon)
  parseFloat(bbox[1]), // n (maxLat)
  parseFloat(bbox[3]), // e (maxLon)
]

// Expand a [s, w, n, e] bbox by deg in all directions
const expandBbox = (bbox: [number, number, number, number], deg: number): [number, number, number, number] => [
  bbox[0] - deg,
  bbox[1] - deg,
  bbox[2] + deg,
  bbox[3] + deg,
]

// Build a square bbox around a centre point at ~radiusKm
const bboxFromCentre = (lat: number, lon: number, radiusKm: number): [number, number, number, number] => {
  const deg = radiusKm / 111 // 1 degree lat ~ 111km
  return [lat - deg, lon - deg, lat + deg, lon + deg]
}

async function nominatimGeocode(suburb: string, state: string): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    q: `${suburb}, ${state}, Australia`,
    format: 'json',
    limit: '5',
    addressdetails: '1',
    'accept-language': 'en',
  })
  try {
    const res = await fetch(`${NOMINATIM_URL}/search?${params}`, {
      headers: { 'User-Agent': 'Scouter suburb review app (scouter.mrated.dev)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const results = await res.json() as (NominatimResult & { class?: string; type?: string })[]
    if (!results.length) return null
    // Prefer the administrative boundary result - this gives the real suburb polygon bbox
    // rather than a point (e.g. a train station that happens to share the suburb name)
    const boundary = results.find(r => r.class === 'boundary' && r.type === 'administrative')
    return boundary ?? results[0]
  } catch {
    return null
  }
}

async function overpassQuery(
  suburbBbox: [number, number, number, number],
  stationBbox: [number, number, number, number],
): Promise<OverpassElement[]> {
  const sb = suburbBbox.join(',')
  const rb = stationBbox.join(',') // rail bbox - 4km radius from centre

  // Two bboxes: suburb boundary for local features, wider radius for transit
  const query = `
[out:json][timeout:25];
(
  // Roads within suburb boundary
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${sb});

  // Train stations within 4km of suburb centre (nodes AND ways - some stations are mapped as ways)
  node["railway"="station"](${rb});
  way["railway"="station"](${rb});
  node["railway"="halt"](${rb});
  way["railway"="halt"](${rb});

  // Ferry terminals and water transport within 4km of suburb centre
  node["amenity"="ferry_terminal"](${rb});
  way["amenity"="ferry_terminal"](${rb});
  way["route"="ferry"](${rb});
  relation["route"="ferry"](${rb});
  relation["amenity"="ferry_terminal"](${rb});

  // Tram stops within suburb
  node["railway"="tram_stop"](${sb});

  // Bus stops within suburb (count only)
  node["highway"="bus_stop"](${sb});

  // Schools within suburb
  node["amenity"="school"](${sb});
  way["amenity"="school"](${sb});

  // Universities / TAFE within suburb
  node["amenity"~"^(university|college)$"](${sb});
  way["amenity"~"^(university|college)$"](${sb});

  // Parks and reserves within suburb
  way["leisure"~"^(park|nature_reserve|garden|recreation_ground)$"](${sb});
  relation["leisure"~"^(park|nature_reserve|garden|recreation_ground)$"](${sb});

  // Supermarkets and shopping centres within suburb
  node["shop"~"^(supermarket|mall|department_store)$"](${sb});
  way["shop"~"^(supermarket|mall|department_store)$"](${sb});
  node["amenity"="marketplace"](${sb});

  // Medical centres, hospitals, GPs within suburb
  node["amenity"~"^(hospital|clinic|doctors)$"](${sb});
  way["amenity"~"^(hospital|clinic|doctors)$"](${sb});

  // Pharmacies within suburb
  node["amenity"="pharmacy"](${sb});

  // Restaurants and cafes within suburb
  node["amenity"~"^(restaurant|cafe|bar)$"](${sb});

  // Points of interest within suburb
  node["amenity"~"^(library|theatre|cinema|community_centre|place_of_worship|swimming_pool|sports_centre)$"](${sb});
  way["amenity"~"^(library|theatre|cinema|community_centre|place_of_worship|swimming_pool|sports_centre)$"](${sb});
  node["leisure"~"^(sports_centre|stadium|swimming_pool|fitness_centre)$"](${sb});
  way["leisure"~"^(sports_centre|stadium|swimming_pool|fitness_centre)$"](${sb});
);
out center body;
`

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return []
    const data = await res.json() as OverpassResponse
    return data.elements ?? []
  } catch {
    return []
  }
}

const nameOf = (el: OverpassElement): string =>
  el.tags?.name ?? el.tags?.['name:en'] ?? ''

const dedupe = (names: string[]): string[] =>
  [...new Map(names.filter(Boolean).map(n => [n.toLowerCase(), n])).values()]

// Classify schools into primary vs secondary using OSM tags + name heuristics
const isPrimary = (el: OverpassElement): boolean => {
  const level = el.tags?.['school:level'] ?? el.tags?.['isced:level'] ?? ''
  const name  = nameOf(el).toLowerCase()
  if (/secondary|high school|college/i.test(level)) return false
  if (/primary|elementary/i.test(level)) return true
  // Name heuristics for AU schools
  if (/primary school|primary$/i.test(name)) return true
  if (/secondary college|high school|senior secondary|college$/i.test(name)) return false
  return true // default untagged schools to primary bucket
}

const isSecondary = (el: OverpassElement): boolean => {
  const level = el.tags?.['school:level'] ?? el.tags?.['isced:level'] ?? ''
  const name  = nameOf(el).toLowerCase()
  if (/primary|elementary/i.test(level)) return false
  if (/secondary|high/i.test(level)) return true
  if (/secondary college|high school|senior secondary/i.test(name)) return true
  return false
}

// Haversine distance in km between two lat/lng points
const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export type OsmResult = {
  /** Prompt text block for LLM injection */
  context: string
  /** Structured station list to directly override LLM output */
  trainStations: Array<{ name: string; lines: string; distanceKm: number }>
  /** Structured road list to directly override LLM output */
  majorRoads: string[]
}

/**
 * Fetches OSM infrastructure data for a suburb and returns structured data
 * plus a grounding text block for the LLM prompt.
 * Returns null if geocoding fails (suburb not found).
 */
export async function fetchOsmContext(suburb: string, state: string): Promise<OsmResult | null> {
  const geo = await nominatimGeocode(suburb, state)
  if (!geo) return null

  // Suburb bbox: the administrative boundary with a tiny buffer (~100m) to catch edge features
  const suburbBbox = expandBbox(parseBbox(geo.boundingbox), 0.001)

  // Derive suburb centre from the boundary bbox midpoint - more reliable than geo.lat/lon
  // which can point to a specific feature (e.g. a train station) rather than the suburb centroid
  const bbox = parseBbox(geo.boundingbox)
  const centreLat = (bbox[0] + bbox[2]) / 2  // (s + n) / 2
  const centreLon = (bbox[1] + bbox[3]) / 2  // (w + e) / 2
  const stationBbox = bboxFromCentre(centreLat, centreLon, 4)

  const elements = await overpassQuery(suburbBbox, stationBbox)

  if (elements.length === 0) return null

  // --- Roads ---
  const roadElements = elements.filter(el =>
    el.type === 'way' && ['motorway', 'trunk', 'primary', 'secondary'].includes(el.tags?.highway ?? ''),
  )
  const roads = dedupe(roadElements.map(nameOf)).slice(0, 12)

  // --- Train stations: structured with real distances ---
  const trainElsRaw = elements.filter(el => el.tags?.railway === 'station' || el.tags?.railway === 'halt')
  // Dedupe by name, keeping first occurrence (nodes have lat/lon, ways have center.lat/lon)
  const seenStations = new Set<string>()
  const trainStationStructured: Array<{ name: string; lines: string; distanceKm: number }> = []
  for (const el of trainElsRaw) {
    const name = nameOf(el)
    if (!name || seenStations.has(name.toLowerCase())) continue
    seenStations.add(name.toLowerCase())
    const elLat = el.lat ?? el.center?.lat
    const elLon = el.lon ?? el.center?.lon
    const distanceKm = elLat != null && elLon != null
      ? Math.round(haversineKm(centreLat, centreLon, elLat, elLon) * 10) / 10
      : 0
    const lines = el.tags?.['railway:line'] ?? el.tags?.network ?? ''
    trainStationStructured.push({ name, lines, distanceKm })
  }
  // Sort by distance, cap at 8
  trainStationStructured.sort((a, b) => a.distanceKm - b.distanceKm)
  const trainStations = trainStationStructured.slice(0, 8)

  // --- Ferry terminals / water transport ---
  const ferryEls = elements.filter(el =>
    el.tags?.amenity === 'ferry_terminal' || el.tags?.route === 'ferry',
  )
  // Normalise directional route names like "Westgate Punt: Spotswood - Fishermans Bend" -> "Westgate Punt"
  const ferryNameOf = (el: OverpassElement): string => {
    const n = nameOf(el)
    return n.includes(':') ? n.split(':')[0].trim() : n
  }
  const ferryServices = dedupe(ferryEls.map(ferryNameOf)).slice(0, 4)

  // --- Tram stops ---
  const tramEls = elements.filter(el => el.tags?.railway === 'tram_stop')
  const tramStops = dedupe(tramEls.map(nameOf)).slice(0, 6)

  // --- Bus stops (count only - individual stop names aren't useful) ---
  const busStopCount = elements.filter(el => el.tags?.highway === 'bus_stop').length

  // --- Schools ---
  const schoolEls = elements.filter(el =>
    el.tags?.amenity === 'school' || el.tags?.amenity === 'university' || el.tags?.amenity === 'college',
  )
  const primaryNames   = dedupe(schoolEls.filter(isPrimary).map(nameOf)).slice(0, 6)
  const secondaryNames = dedupe(schoolEls.filter(isSecondary).map(nameOf)).slice(0, 6)
  const tertiaryNames  = dedupe(
    elements.filter(el => el.tags?.amenity === 'university' || el.tags?.amenity === 'college').map(nameOf),
  ).slice(0, 4)

  // --- Parks ---
  const parkEls = elements.filter(el =>
    ['park', 'nature_reserve', 'garden', 'recreation_ground'].includes(el.tags?.leisure ?? ''),
  )
  const parks = dedupe(parkEls.map(nameOf)).slice(0, 8)

  // --- Supermarkets / shopping ---
  const shopEls = elements.filter(el =>
    ['supermarket', 'mall', 'department_store'].includes(el.tags?.shop ?? '') ||
    el.tags?.amenity === 'marketplace',
  )
  const shops = dedupe(shopEls.map(nameOf)).slice(0, 6)

  // --- Medical ---
  const medEls = elements.filter(el =>
    ['hospital', 'clinic', 'doctors'].includes(el.tags?.amenity ?? ''),
  )
  const medical = dedupe(medEls.map(nameOf)).slice(0, 6)
  const pharmacyCount = elements.filter(el => el.tags?.amenity === 'pharmacy').length

  // --- Dining ---
  const diningEls = elements.filter(el =>
    ['restaurant', 'cafe', 'bar'].includes(el.tags?.amenity ?? ''),
  )
  const dining = dedupe(diningEls.map(nameOf).filter(Boolean)).slice(0, 8)
  const diningCount = diningEls.length

  // --- POI ---
  const poiEls = elements.filter(el =>
    ['library', 'theatre', 'cinema', 'community_centre', 'place_of_worship',
     'swimming_pool', 'sports_centre'].includes(el.tags?.amenity ?? '') ||
    ['sports_centre', 'stadium', 'swimming_pool', 'fitness_centre'].includes(el.tags?.leisure ?? ''),
  )
  const pois = dedupe(poiEls.map(nameOf)).slice(0, 8)

  // --- Format as grounding block ---
  const lines: string[] = [
    `OSM infrastructure data for ${suburb}, ${state} (source: OpenStreetMap, fetched live):`,
    '',
  ]

  const add = (label: string, items: string[], count?: number) => {
    if (items.length > 0) {
      lines.push(`${label}: ${items.join(', ')}${count !== undefined && count > items.length ? ` (+ ${count - items.length} more unnamed)` : ''}`)
    } else if (count !== undefined && count > 0) {
      lines.push(`${label}: ${count} found (names unavailable in OSM)`)
    }
  }

  add('Major roads', roads)
  add('Train stations nearby', trainStations.map(s => `${s.name}${s.distanceKm ? ` (${s.distanceKm}km)` : ''}`))
  if (ferryServices.length > 0) add('Ferry/water transport nearby', ferryServices)
  if (tramStops.length > 0) add('Tram stops nearby', tramStops)
  if (busStopCount > 0) lines.push(`Bus stops: ${busStopCount} stops mapped in area`)
  add('Primary schools', primaryNames)
  add('Secondary schools', secondaryNames)
  if (tertiaryNames.length > 0) add('Tertiary (university/TAFE)', tertiaryNames)
  add('Parks and reserves', parks)
  add('Supermarkets/shopping', shops)
  add('Medical centres/hospitals', medical)
  if (pharmacyCount > 0) lines.push(`Pharmacies: ${pharmacyCount} mapped`)
  if (dining.length > 0) {
    lines.push(`Restaurants/cafes (named in OSM): ${dining.join(', ')} (total mapped: ${diningCount} - OSM dining coverage is partial, supplement with local knowledge)`)
  } else if (diningCount > 0) {
    lines.push(`Restaurants/cafes: ${diningCount} mapped in OSM (names unavailable - supplement with local knowledge)`)
  }
  add('Points of interest', pois)

  lines.push('')
  lines.push('IMPORTANT: Use the above OSM data as the authoritative source for named infrastructure (roads, schools, parks, shops, medical). Do not invent or substitute names not present in this data. For dining/restaurants where OSM coverage is partial, you may supplement with well-known establishments you have knowledge of, but clearly note if uncertain.')

  return {
    context: lines.join('\n'),
    trainStations,
    majorRoads: roads,
  }
}

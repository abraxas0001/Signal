/**
 * A small, hand-checked gazetteer of Indian places → [lon, lat].
 *
 * This exists so the constituency map and the news-origin map can place a
 * name WITHOUT a network geocoder (the product runs offline and on 4G). It is
 * deliberately honest: `resolvePlace` returns null for anything not listed,
 * and every map treats null as "we could not place this" rather than dropping
 * a pin somewhere plausible. Coverage is weighted to Telangana and Andhra
 * Pradesh — the desk's actual beat — then state capitals and metros.
 *
 * Coordinates are town/city centroids to ~2 decimals. Not survey-grade, and
 * not claimed to be: a dot on a stylised dotted map, not a cadastral boundary.
 */

export interface Place {
  name: string
  lon: number
  lat: number
  /** State, for disambiguation and the label's second line. */
  state: string
  kind: 'metro' | 'capital' | 'city' | 'district' | 'constituency'
}

/* Telangana — the desk's home ground, so the densest coverage. */
const TELANGANA: Place[] = [
  { name: 'Hyderabad', lon: 78.47, lat: 17.38, state: 'Telangana', kind: 'metro' },
  { name: 'Mahabubnagar', lon: 77.99, lat: 16.74, state: 'Telangana', kind: 'district' },
  { name: 'Gadwal', lon: 77.8, lat: 16.23, state: 'Telangana', kind: 'constituency' },
  { name: 'Wanaparthy', lon: 78.06, lat: 16.36, state: 'Telangana', kind: 'district' },
  { name: 'Nagarkurnool', lon: 78.32, lat: 16.48, state: 'Telangana', kind: 'district' },
  { name: 'Jogulamba Gadwal', lon: 77.8, lat: 16.23, state: 'Telangana', kind: 'district' },
  { name: 'Alampur', lon: 78.13, lat: 15.88, state: 'Telangana', kind: 'constituency' },
  { name: 'Warangal', lon: 79.59, lat: 17.97, state: 'Telangana', kind: 'city' },
  { name: 'Nizamabad', lon: 78.09, lat: 18.67, state: 'Telangana', kind: 'city' },
  { name: 'Karimnagar', lon: 79.13, lat: 18.44, state: 'Telangana', kind: 'city' },
  { name: 'Khammam', lon: 80.15, lat: 17.25, state: 'Telangana', kind: 'city' },
  { name: 'Nalgonda', lon: 79.27, lat: 17.05, state: 'Telangana', kind: 'district' },
  { name: 'Siddipet', lon: 78.85, lat: 18.1, state: 'Telangana', kind: 'district' },
  { name: 'Adilabad', lon: 78.53, lat: 19.67, state: 'Telangana', kind: 'district' },
  { name: 'Suryapet', lon: 79.62, lat: 17.14, state: 'Telangana', kind: 'district' },
]

/* Andhra Pradesh — the neighbouring beat. */
const ANDHRA: Place[] = [
  { name: 'Amaravati', lon: 80.52, lat: 16.51, state: 'Andhra Pradesh', kind: 'capital' },
  { name: 'Vijayawada', lon: 80.65, lat: 16.51, state: 'Andhra Pradesh', kind: 'city' },
  { name: 'Visakhapatnam', lon: 83.22, lat: 17.69, state: 'Andhra Pradesh', kind: 'metro' },
  { name: 'Guntur', lon: 80.44, lat: 16.31, state: 'Andhra Pradesh', kind: 'city' },
  { name: 'Tirupati', lon: 79.42, lat: 13.63, state: 'Andhra Pradesh', kind: 'city' },
  { name: 'Kurnool', lon: 78.04, lat: 15.83, state: 'Andhra Pradesh', kind: 'city' },
  { name: 'Nellore', lon: 79.99, lat: 14.44, state: 'Andhra Pradesh', kind: 'city' },
  { name: 'Kadapa', lon: 78.82, lat: 14.47, state: 'Andhra Pradesh', kind: 'city' },
  { name: 'Anantapur', lon: 77.6, lat: 14.68, state: 'Andhra Pradesh', kind: 'district' },
  { name: 'Rajahmundry', lon: 81.78, lat: 17.0, state: 'Andhra Pradesh', kind: 'city' },
  { name: 'Eluru', lon: 81.1, lat: 16.71, state: 'Andhra Pradesh', kind: 'city' },
]

/* State capitals + metros, so a national story still lands somewhere. */
const NATIONAL: Place[] = [
  { name: 'New Delhi', lon: 77.21, lat: 28.61, state: 'Delhi', kind: 'capital' },
  { name: 'Delhi', lon: 77.1, lat: 28.7, state: 'Delhi', kind: 'metro' },
  { name: 'Mumbai', lon: 72.88, lat: 19.08, state: 'Maharashtra', kind: 'metro' },
  { name: 'Bengaluru', lon: 77.59, lat: 12.97, state: 'Karnataka', kind: 'metro' },
  { name: 'Bangalore', lon: 77.59, lat: 12.97, state: 'Karnataka', kind: 'metro' },
  { name: 'Chennai', lon: 80.27, lat: 13.08, state: 'Tamil Nadu', kind: 'metro' },
  { name: 'Kolkata', lon: 88.36, lat: 22.57, state: 'West Bengal', kind: 'metro' },
  { name: 'Pune', lon: 73.86, lat: 18.52, state: 'Maharashtra', kind: 'city' },
  { name: 'Ahmedabad', lon: 72.57, lat: 23.03, state: 'Gujarat', kind: 'metro' },
  { name: 'Gandhinagar', lon: 72.63, lat: 23.22, state: 'Gujarat', kind: 'capital' },
  { name: 'Jaipur', lon: 75.79, lat: 26.91, state: 'Rajasthan', kind: 'capital' },
  { name: 'Lucknow', lon: 80.95, lat: 26.85, state: 'Uttar Pradesh', kind: 'capital' },
  { name: 'Bhopal', lon: 77.41, lat: 23.26, state: 'Madhya Pradesh', kind: 'capital' },
  { name: 'Patna', lon: 85.14, lat: 25.59, state: 'Bihar', kind: 'capital' },
  { name: 'Chandigarh', lon: 76.78, lat: 30.73, state: 'Punjab', kind: 'capital' },
  { name: 'Thiruvananthapuram', lon: 76.94, lat: 8.52, state: 'Kerala', kind: 'capital' },
  { name: 'Bhubaneswar', lon: 85.82, lat: 20.3, state: 'Odisha', kind: 'capital' },
  { name: 'Guwahati', lon: 91.74, lat: 26.14, state: 'Assam', kind: 'city' },
  { name: 'Raipur', lon: 81.63, lat: 21.25, state: 'Chhattisgarh', kind: 'capital' },
  { name: 'Ranchi', lon: 85.31, lat: 23.34, state: 'Jharkhand', kind: 'capital' },
  { name: 'Dehradun', lon: 78.03, lat: 30.32, state: 'Uttarakhand', kind: 'capital' },
  { name: 'Shimla', lon: 77.17, lat: 31.1, state: 'Himachal Pradesh', kind: 'capital' },
  { name: 'Panaji', lon: 73.83, lat: 15.49, state: 'Goa', kind: 'capital' },
  { name: 'Nagpur', lon: 79.09, lat: 21.15, state: 'Maharashtra', kind: 'city' },
  { name: 'Coimbatore', lon: 76.96, lat: 11.02, state: 'Tamil Nadu', kind: 'city' },
  { name: 'Kochi', lon: 76.27, lat: 9.93, state: 'Kerala', kind: 'city' },
  { name: 'Surat', lon: 72.83, lat: 21.17, state: 'Gujarat', kind: 'city' },
  { name: 'Varanasi', lon: 82.97, lat: 25.32, state: 'Uttar Pradesh', kind: 'city' },
  { name: 'Amritsar', lon: 74.87, lat: 31.63, state: 'Punjab', kind: 'city' },
  { name: 'Srinagar', lon: 74.8, lat: 34.08, state: 'Jammu & Kashmir', kind: 'city' },
]

export const GAZETTEER: readonly Place[] = [...TELANGANA, ...ANDHRA, ...NATIONAL]

const INDEX = new Map<string, Place>()
for (const p of GAZETTEER) {
  const key = p.name.toLowerCase()
  if (!INDEX.has(key)) INDEX.set(key, p)
}

/**
 * Resolve a free-text place (a constituency, district, or a phrase that
 * contains one) to a Place, or null. Tries the whole string, then each word,
 * longest-first, so "Gadwal constituency, Mahabubnagar" resolves to Gadwal.
 * Honest by construction: an unknown name returns null, never a guess.
 */
export function geocodePlace(text: string | null | undefined): Place | null {
  if (!text) return null
  const lower = text.toLowerCase()
  const direct = INDEX.get(lower.trim())
  if (direct) return direct
  // Longest gazetteer names first, so "Mahabubnagar" wins over a stray "nagar".
  const names = [...INDEX.keys()].sort((a, b) => b.length - a.length)
  for (const name of names) {
    if (lower.includes(name)) return INDEX.get(name) ?? null
  }
  return null
}

/** The desk's default centre when nothing resolves: geographic India. */
export const INDIA_CENTRE = { lon: 79.5, lat: 22 } as const

/**
 * Party → map colour. The constituency dots take the colour of the party the
 * tracked person belongs to, so a BJP desk lights saffron and a Congress desk
 * lights its own blue. Matched loosely (a free-text party string is folded and
 * scanned for a known token), and it falls back to the product accent when the
 * party is unknown — never a wrong colour asserted with confidence.
 */
const PARTY_COLORS: { tokens: string[]; color: string }[] = [
  { tokens: ['bjp', 'bharatiya janata'], color: '#EE7B1B' }, // saffron
  { tokens: ['inc', 'congress'], color: '#19A3E8' }, // Congress sky blue
  { tokens: ['brs', 'trs', 'telangana rashtra', 'bharat rashtra'], color: '#E5679B' }, // pink
  { tokens: ['ysrcp', 'ysr congress', 'yuvajana'], color: '#1C6FD6' },
  { tokens: ['tdp', 'telugu desam'], color: '#E8C21C' }, // yellow
  { tokens: ['aap', 'aam aadmi'], color: '#1F8F4F' },
  { tokens: ['dmk'], color: '#D6322B' },
  { tokens: ['aimim'], color: '#0F7A4D' },
  { tokens: ['cpi', 'cpm', 'communist'], color: '#D6322B' },
  { tokens: ['shiv sena', 'shivsena', 'sena'], color: '#E8791B' },
]

export function partyColor(party: string | null | undefined): string {
  if (!party) return 'var(--accent)'
  const lower = party.toLowerCase()
  for (const p of PARTY_COLORS) {
    if (p.tokens.some((t) => lower.includes(t))) return p.color
  }
  return 'var(--accent)'
}

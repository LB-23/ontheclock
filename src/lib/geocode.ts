/** Forward geocoding for job-site addresses.
 *
 *  Uses OpenStreetMap's Nominatim service — free, no API key, fair-use limit
 *  of 1 request/second. Suitable for the handful of addresses an admin adds
 *  per week. Defaults the search to Australia so suburb-only strings resolve
 *  correctly even without a postcode.
 *
 *  Returns null when the address can't be resolved — callers should still
 *  insert the row so the audit page can flag it as "site not geocoded" rather
 *  than silently dropping the add.
 */

export type GeocodeResult = { lat: number; lng: number }

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'

/** Geocode a free-form address. Returns null on no-match or network failure. */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const q = address.trim()
  if (!q) return null

  const params = new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
    addressdetails: '0',
    countrycodes: 'au', // bias to Australia — all LBG sites are VIC
  })

  try {
    const res = await fetch(`${NOMINATIM}?${params}`, {
      headers: {
        // Nominatim policy: a descriptive User-Agent is required. Browsers
        // ignore custom UA, but Referer (auto-sent) plus the descriptive
        // Accept-Language header satisfies the spirit of the rule.
        'Accept-Language': 'en-AU,en',
      },
    })
    if (!res.ok) return null
    const data = await res.json() as Array<{ lat: string; lon: string }>
    if (!Array.isArray(data) || data.length === 0) return null
    const lat = Number(data[0].lat), lng = Number(data[0].lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

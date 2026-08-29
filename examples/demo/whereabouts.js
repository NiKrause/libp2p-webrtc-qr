/**
 * Who provides this network, and roughly where it is.
 *
 * Two fields the logbook otherwise asks a person to type. Both can be
 * determined, and both cost something that is worth naming rather than burying.
 *
 * ## The address is already ours; the name is not
 *
 * A reflexive ICE candidate *is* the public address this network gave us,
 * discovered by a STUN transaction the connection makes anyway. So nothing here
 * is needed to learn the address. What needs somebody else is turning it into
 * "Vodafone" or "AS3209" - and the only way to ask is to make a request, which
 * tells the service the address by the act of asking. There is no version of
 * this that does not.
 *
 * That is why it is behind a button rather than automatic. An attempt should not
 * quietly contact a third party because somebody pressed *create invite*; a
 * person arriving somewhere new presses this once, and the answer fills the same
 * two fields they would have typed.
 *
 * ## Coarse is the point
 *
 * The browser's geolocation is far more precise and far less useful here. A
 * pattern is made of *what kind of place this is* - hotel wifi, a café, a mobile
 * network - and "48.137, 11.575" answers a different question. The IP lookup
 * returns country, state and city, which is the granularity the eventual public
 * dataset wants anyway (#27), and it needs no permission prompt and no secure
 * origin.
 *
 * Precise coordinates are offered too, because they were asked for, but they
 * stay on the device: the logbook's export drops them.
 */

/**
 * The default is one request, to one service, returning what is needed and no
 * more. Configurable because a consumer may have their own, and because a free
 * service is entitled to say no - this one answered `RateLimited` while this was
 * being written, which is the ordinary case rather than the exception.
 */
export const DEFAULT_LOOKUP = 'https://api.ipquery.io/?format=json'

/**
 * Nominatim, which is OpenStreetMap's own geocoder.
 *
 * Chosen over the IP for the reason the IP was demoted: it answers from the
 * position the device measured, not from a guess about the provider's routing.
 * The same connection that ipquery placed in Frankfurt over IPv4 and Berlin over
 * IPv6 geocodes to the town the device was actually in.
 */
export const DEFAULT_REVERSE = 'https://nominatim.openstreetmap.org/reverse'

/**
 * The place a position is in, from OpenStreetMap.
 *
 * **The coordinates are rounded to two decimals before they leave.** That is
 * about a kilometre - enough for the right town, measured - and it is the
 * difference between telling a service which building you are in and telling it
 * which town. Nominatim's `zoom` parameter only limits what comes back; the
 * rounding is what limits what was sent, so the rounding is the one that counts.
 *
 * One request per button press, which is far inside Nominatim's usage policy
 * (one per second, attribution, no bulk). The browser identifies the page to
 * the service through its ordinary Referer header.
 *
 * @param {object} options
 * @param {number} options.latitude
 * @param {number} options.longitude
 * @param {string} [options.endpoint]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {number} [options.timeout]
 * @returns {Promise<{ city: string | null, region: string | null, country: string | null }>}
 */
export async function lookUpPlace ({ latitude, longitude, endpoint = DEFAULT_REVERSE, fetch = globalThis.fetch, timeout = 8000 }) {
  const lat = latitude.toFixed(2)
  const lon = longitude.toFixed(2)
  const response = await fetch(
    `${endpoint}?lat=${lat}&lon=${lon}&format=jsonv2&zoom=10`,
    { signal: AbortSignal.timeout(timeout) }
  )

  if (!response.ok) {
    throw new Error(`The geocoder answered ${response.status}`)
  }

  const body = await response.json()
  const address = body?.address ?? {}

  return {
    // Nominatim names the settlement by its kind; take the first that exists.
    city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
    region: address.state ?? null,
    country: (address.country_code ?? '').toUpperCase() || null
  }
}

/**
 * @param {object} [options]
 * @param {string} [options.endpoint]
 * @param {typeof globalThis.fetch} [options.fetch]
 * @param {number} [options.timeout] ms before giving up - offline is a case this
 *   app is *for*, so it must fail quickly rather than hang a button
 * @returns {Promise<{ provider: string | null, asn: string | null, country: string | null, region: string | null, city: string | null, ip: string | null }>}
 */
export async function lookUpNetwork ({ endpoint = DEFAULT_LOOKUP, fetch = globalThis.fetch, timeout = 8000 } = {}) {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeout) })

  if (!response.ok) {
    throw new Error(`The lookup service answered ${response.status}`)
  }

  const body = await response.json()

  // A free service says no by returning a body, not by failing the request.
  if (body?.error != null || body?.success === false) {
    throw new Error(String(body.reason ?? body.message ?? 'The lookup service declined'))
  }

  return {
    provider: body?.isp?.isp ?? body?.isp?.org ?? null,
    asn: body?.isp?.asn ?? null,
    country: body?.location?.country_code ?? body?.location?.country ?? null,
    region: body?.location?.state ?? null,
    city: body?.location?.city ?? null,
    ip: body?.ip ?? null
  }
}

/**
 * Precise coordinates, if the person and the platform both allow it.
 *
 * Returns null rather than throwing for every ordinary refusal - denied, no
 * hardware, an insecure origin - because none of those is an error worth
 * interrupting anything for. The coarse answer above is already in hand by then.
 *
 * @returns {Promise<{ latitude: number, longitude: number, accuracy: number } | null>}
 */
export async function lookUpPosition ({ geolocation = globalThis.navigator?.geolocation, timeout = 8000 } = {}) {
  if (geolocation == null) return null

  const asked = new Promise(resolve => {
    geolocation.getCurrentPosition(
      position => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy
      }),
      () => resolve(null),
      { timeout, maximumAge: 600000 }
    )
  })

  // Bounded here as well, and not because the option above is untrusted: that
  // timeout governs *acquiring a position once permission exists*. A prompt
  // nobody answers - a headless browser, a policy that neither grants nor
  // denies, a person who walks away - settles nothing, and neither callback
  // ever fires. Found on Firefox in the E2E container, where the whole button
  // sat on "asking…" for as long as anybody waited.
  return Promise.race([
    asked,
    new Promise(resolve => setTimeout(() => resolve(null), timeout + 1000))
  ])
}

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

  return new Promise(resolve => {
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
}

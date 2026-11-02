// Choosing which address family an invite is allowed to offer.
//
// "Does IPv6 work between these two networks" is not a question a browser will
// answer. There is no API for it: ICE gathers what it finds and nominates
// whatever pair succeeds first, and if that pair is IPv4 the IPv6 question was
// never asked. Every attempt to measure a family ends up measuring both.
//
// **We do not need the browser's permission, because we own the payload.** A
// peer only ever probes candidate pairs it knows about, and what the other side
// knows is exactly what we sent it. So dropping a family before encoding takes
// it out of play on *that* side - and dropping it from what we accept takes it
// out on ours.
//
// Which is why one device is enough. If A filters both directions:
//
//   - A pairs its own candidates only against the ones it kept from B, so A
//     probes one family.
//   - B pairs its own against what A sent, which carries one family, so B
//     probes one family too - without being told anything, and without running
//     a build that knows this file exists.
//
// Nothing has to travel with the invite, and nothing should: a link that
// silently restricted the recipient's connection would be a link that breaks
// their app to answer somebody else's question.

/** The two families a filter can ask for. Anything else means "do not filter". */
export const ADDRESS_FAMILIES = ['v4', 'v6']

/**
 * A short vocabulary, checked rather than trusted - the same shape the demo's
 * scenario names use. A typo that fell through as a filter nobody asked for
 * would quietly cripple every invite the page made.
 *
 * @param {unknown} value
 * @returns {'v4' | 'v6' | null}
 */
export function asAddressFamily (value) {
  return ADDRESS_FAMILIES.includes(value) ? value : null
}

/** For a message somebody reads. The wire vocabulary is not prose. */
export function familyLabel (family) {
  return family === 'v6' ? 'IPv6' : family === 'v4' ? 'IPv4' : 'any'
}

/**
 * Which family an ICE candidate's address belongs to.
 *
 * `.local` is its own answer rather than a family, and that distinction is the
 * reason this is a function and not an `includes(':')` at three call sites. An
 * mDNS name says the browser *withheld* its address - the name resolves to
 * something, but only on a machine that can resolve it, and nothing in the
 * candidate says which family that something is.
 *
 * @param {string | null | undefined} address
 * @returns {'v4' | 'v6' | 'mdns' | null}
 */
export function familyOf (address) {
  if (address == null || address === '') return null
  if (address.endsWith('.local')) return 'mdns'

  return address.includes(':') ? 'v6' : 'v4'
}

/**
 * The address out of a candidate line, with or without its `a=candidate:`
 * prefix.
 *
 * Both forms occur: an SDP carries the prefix, a compact payload carries the
 * rest of the line without it. The address is the fifth field either way
 * (foundation, component, transport, priority, **address**, port, `typ`, type),
 * so one reader covers both and the two formats cannot drift apart.
 *
 * Exported because the v3 half of a payload is a list of these lines, and a
 * consumer recording which families it offered would otherwise write this
 * `split` itself - which is where two answers to "which field is the address"
 * come from.
 *
 * @param {string} line
 */
export function candidateAddress (line) {
  return String(line).replace(/^a=candidate:/u, '').trim().split(/\s+/u)[4] ?? null
}

/**
 * Keep a candidate line, or not.
 *
 * An mDNS candidate is dropped by any filter, deliberately. Keeping one would
 * mean a run labelled "IPv6 only" that connected over a `.local` host candidate
 * - which may well have been IPv4 - and a measurement that cannot rule that out
 * is worse than no measurement, because it looks like one. It is the same trap
 * as a phone tethering another phone and calling it mobile data.
 *
 * @param {string} line
 * @param {'v4' | 'v6'} family
 */
function keeps (line, family) {
  return familyOf(candidateAddress(line)) === family
}

/**
 * The same SDP with one family's candidates removed, and nothing else touched.
 *
 * A no-op when no family is asked for: the string comes back as it arrived
 * rather than rebuilt, so the usual path cannot be broken by a reformatting bug
 * in here.
 *
 * @param {string} sdp
 * @param {'v4' | 'v6' | null} [family]
 */
export function filterSdpCandidates (sdp, family = null) {
  const wanted = asAddressFamily(family)

  if (wanted == null || sdp == null) return sdp

  // The line *and* its terminator, so removing one leaves no blank line behind.
  // `.` matches neither \n nor \r in JavaScript, so `.*` stops at the end of the
  // line on its own and the terminator is matched explicitly - the last line of
  // an SDP may have none.
  return sdp.replace(/^a=candidate:.*(?:\r?\n)?/gmu, line => keeps(line, wanted) ? line : '')
}

/**
 * The compact format's candidate list, filtered the same way.
 *
 * Separate from the SDP path because v3 never builds a string to filter: the
 * list is what is signed on the way out and what rebuilds the description on the
 * way in.
 *
 * @param {string[]} [lines]
 * @param {'v4' | 'v6' | null} [family]
 */
export function filterCandidateLines (lines = [], family = null) {
  const wanted = asAddressFamily(family)

  if (wanted == null) return lines

  return lines.filter(line => keeps(line, wanted))
}

/**
 * Which families a set of candidate addresses belongs to.
 *
 * Addresses rather than whole lines, because the two payload formats arrive as
 * different things - an SDP that `readIceCandidates` has already reduced to
 * `{ address, port, type }`, or a list of lines that `candidateAddress` reads.
 * Taking the narrower input keeps one of those from having to be rebuilt into
 * the other.
 *
 * Sorted and deduplicated, and `null` rather than an empty array when there is
 * nothing to report - a reader distinguishing "no candidates" from "candidates
 * in no family" would be distinguishing nothing.
 *
 * @param {Array<string | null | undefined>} addresses
 * @returns {Array<'v4' | 'v6' | 'mdns'> | null}
 */
export function familiesOffered (addresses = []) {
  const families = new Set(
    addresses
      .map(address => familyOf(address))
      .filter(family => family != null)
  )

  return families.size > 0 ? [...families].sort() : null
}

/**
 * A stable name for one candidate, for a person to point at.
 *
 * Address alone will not do: a host candidate and the reflexive candidate
 * discovered through it share a socket, so they share a port while differing in
 * address - and a TCP candidate can share an address and port with a UDP one on
 * another interface. Type, transport, address and port together are unique
 * within one gathering and survive re-reading the same `localDescription`,
 * which is what a checkbox needs: the same candidate has to keep the same name
 * between the list being drawn and the selection coming back.
 *
 * @param {string} line a candidate line, with or without `a=candidate:`
 */
export function candidateKey (line) {
  const parts = String(line).replace(/^a=candidate:/u, '').trim().split(/\s+/u)
  const [, , transport, , address, port, , type] = parts

  return `${type ?? '?'}|${String(transport ?? '?').toLowerCase()}|${address ?? '?'}|${port ?? '?'}`
}

/**
 * The same SDP with named candidates removed.
 *
 * ## This does **not** inherit the guarantee at the top of this file
 *
 * The family filter can honestly say that dropping a family takes it out of
 * play, because ICE never pairs across families: what the other side does not
 * know about, it cannot probe, and what this side dropped on the way in, it
 * cannot probe either. Both halves hold.
 *
 * Dropping a single address within a family keeps only the first half. The
 * local ICE agent gathered that candidate and still holds it, so it pairs it
 * against everything the other side *did* send and puts binding requests on the
 * wire from it. Measured, not reasoned (#192): with both host candidates
 * removed from the payload, every one of the offerer's four candidate pairs was
 * sourced from a candidate the offerer had never advertised, 24-25 requests
 * each. The far end learns such an address as the source of a packet whether or
 * not its ICE stack files it as peer-reflexive.
 *
 * So this is a control over **what an invite offers as a route**, and it is
 * worth having as that. It is not a control over what leaves the machine, and
 * anything built on top of it must not say otherwise.
 *
 * @param {string} sdp
 * @param {Iterable<string>} [keys] candidate keys, as `candidateKey` builds them
 */
export function omitSdpCandidates (sdp, keys = []) {
  const excluded = new Set(keys)

  if (excluded.size === 0 || sdp == null) return sdp

  return sdp.replace(/^a=candidate:.*(?:\r?\n)?/gmu, line =>
    excluded.has(candidateKey(line)) ? '' : line)
}

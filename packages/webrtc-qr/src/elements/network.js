/**
 * What this network will let you do, before anyone tries to connect.
 *
 * Two peers behind symmetric NAT cannot reach each other however good the
 * signalling was, and finding that out after a thirty second timeout is the
 * worst way to learn it. This asks two STUN servers what the outside world sees
 * and reads the answer per address family.
 */

/**
 * Asked over IPv6 literals as well as by name. A reflexive candidate exists only
 * for a family a STUN transaction actually used, so a resolver that returns A
 * but no AAAA leaves a machine with working IPv6 gathering no IPv6 candidate at
 * all - and the peers then never exchange the addresses that would have beaten
 * carrier NAT without a relay.
 *
 * The literals are the AAAA records of the two servers above and were measured,
 * not copied. `2606:4700:4700::1111` sat here for a while and answers nothing:
 * it is Cloudflare's public *resolver* - the IPv6 twin of 1.1.1.1 - and not
 * their STUN service, which is `2606:4700:49::`. A dead entry costs nothing
 * visible and quietly halves the evidence behind an IPv6 verdict, which is the
 * worst way for a mistake to sit.
 */
export const DEFAULT_RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:[2606:4700:49::]:3478' },
    { urls: 'stun:[2001:4860:4864:5:8000::1]:19302' }
  ]
}

/**
 * 2000::/3 is the only IPv6 range routed on the public internet. Unique-local
 * (fc00::/7) and link-local (fe80::/10) addresses are as useless to a peer
 * elsewhere as a 192.168 address is.
 */
export function isGlobalUnicastV6 (address) {
  if (typeof address !== 'string' || !address.includes(':')) {
    return false
  }

  return /^[23]/.test(address.replace(/^\[/, ''))
}

/**
 * Combine the two per-family verdicts into the one that answers the question
 * the user actually has: can I reach anyone from here?
 *
 * Either family being usable is enough - the peers negotiate over whichever
 * one works, and IPv6 does not care that IPv4 sits behind a carrier NAT.
 */
/**
 * `unproven` ranks with `symmetric`, not with `open`.
 *
 * A device holding a global IPv6 address will have it offered to a peer whatever
 * this panel says - the verdict advises, it never filters candidates. What it
 * must not do is call an untested path usable: a summary that goes green on an
 * address nobody has reached would be the one overclaim this whole panel exists
 * to avoid.
 */
const NETWORK_RANK = { open: 3, relay: 3, symmetric: 2, unproven: 2, blocked: 1 }

export function summariseNetwork (ipv4, ipv6) {
  const best = NETWORK_RANK[ipv4.state] >= NETWORK_RANK[ipv6.state] ? ipv4 : ipv6

  if (NETWORK_RANK[best.state] === 3) {
    const usable = [
      NETWORK_RANK[ipv4.state] === 3 ? 'IPv4' : null,
      NETWORK_RANK[ipv6.state] === 3 ? 'IPv6' : null
    ].filter(Boolean)

    return {
      state: best.state,
      text: usable.length === 2
        ? 'Reachable over IPv4 and IPv6 - peers on other networks should be able to connect.'
        : usable[0] === 'IPv6'
          ? 'Reachable over IPv6 - a peer that also has IPv6 connects directly, with no NAT to defeat.'
          : 'Reachable over IPv4 - peers on other networks should be able to connect.'
    }
  }

  // Rank, not the literal state. `unproven` was given rank 2 so it would never
  // be treated as blocked, and this branch then tested for the word `symmetric`
  // and sent it to the red one anyway - so an untested IPv6 beside a blocked
  // IPv4 produced "this network cannot reach a peer elsewhere" while an address
  // was being offered that might well reach one.
  if (NETWORK_RANK[best.state] === 2) {
    return {
      state: best.state,
      text: best.state === 'unproven'
        ? 'Peers on this same network are fine. Off it, the only candidate is an IPv6 address nothing was shown to reach - it may work and it was not demonstrated, so treat a failure elsewhere as expected rather than surprising.'
        : 'Peers on this same network are fine. Reaching anyone else needs IPv6 on both sides, or a relay.'
    }
  }

  return {
    state: 'blocked',
    text: 'No usable path off this network was found. Only peers on this same network are reachable.'
  }
}

/**
 * Is this network unable to reach a peer anywhere else?
 *
 * True only for the `blocked` verdict - no reflexive candidate on either family,
 * as on a mobile network with STUN blocked and no IPv6. That is the case worth
 * an alarm: an invite made here cannot connect to anyone off this network, so a
 * consumer should say so loudly, or gate its own connect control on it.
 *
 * Symmetric NAT is deliberately *not* alarming. A reflexive candidate exists,
 * it just maps per destination - it still reaches same-network peers, and
 * sometimes punches through to a non-symmetric peer - so it stays the weaker
 * amber warning rather than a red alarm.
 *
 * @param {{ overall?: { state?: string } } | null | undefined} result
 */
export function offNetworkBlocked (result) {
  return result?.overall?.state === 'blocked'
}

/**
 * How badly this network is placed to reach a peer somewhere else.
 *
 * `offNetworkBlocked` alone turned out to be too narrow in practice. A phone on
 * 5G typically reports IPv4 `symmetric` (carrier NAT) and IPv6 `blocked`, which
 * summarises as `symmetric` - so no alarm fired, while the honest answer is that
 * an invite made there will almost certainly not connect to anyone elsewhere.
 * Reaching a peer from a symmetric NAT needs the *other* side to be open, and
 * hoping for that is not something to leave unsaid.
 *
 * Two levels rather than one, because they are not the same failure and should
 * not read as one:
 *
 * - `blocked`   - no reflexive candidate at all. Nothing off this network.
 * - `unreliable` - a reflexive candidate exists but maps per destination. Same
 *                  network fine, elsewhere only if the other side is open.
 *
 * @param {{ overall?: { state?: string } } | null | undefined} result
 * @returns {'blocked' | 'unreliable' | null}
 */
export function offNetworkRisk (result) {
  const state = result?.overall?.state

  if (state === 'blocked') return 'blocked'
  // `unproven` warns at the quieter level for the same reason it exists: an
  // address is being offered, so silence would be wrong, and red would claim a
  // failure nobody observed.
  if (state === 'symmetric' || state === 'unproven') return 'unreliable'

  return null
}

/**
 * Ask the network what it will allow, before anyone tries to connect.
 *
 * A throwaway peer connection gathers candidates against both STUN servers, and
 * the answer is read per address family. A reflexive candidate is *not* on its
 * own good news for IPv4 - a symmetric NAT hands one out too, it is simply
 * useless towards a different peer. What gives it away is the mapping: two
 * different public ports in the same family mean the NAT picks a new mapping
 * per destination, and hole punching with an arbitrary peer will not work.
 *
 * Grouping by family rather than by base address is not a simplification, it is
 * the only option: every engine masks the base behind a reflexive candidate as
 * `raddr 0.0.0.0 rport 0`. It also fixes a real misreading - keying by
 * `relatedPort` put the IPv4 and IPv6 candidates in the same bucket, whose
 * ports of course differ, so a plain cone NAT was reported as symmetric.
 *
 * The residual blind spot: two interfaces in the same family (a VPN next to
 * wifi) have different base ports, so they read as symmetric. That errs towards
 * the pessimistic label, which is the safer direction given nothing is disabled
 * on the strength of it.
 */
/** Enough to see every interface that matters, few enough to read. */
const CANDIDATE_LIMIT = 24

export async function probeNetwork (rtcConfiguration = DEFAULT_RTC_CONFIGURATION) {
  const probe = new RTCPeerConnection(rtcConfiguration)
  const ports = { v4: new Set(), v6: new Set() }
  /**
   * Every candidate, not only the ones the verdict turns on.
   *
   * The verdict answers "will this work"; the list answers "what changed" -
   * which is the question somebody has after switching a VPN on, and one no
   * summary can answer. Two probes either show the same addresses or they do
   * not.
   *
   * Deduplicated because several STUN servers routinely report the same
   * mapping, and bounded because a machine with many interfaces can gather
   * dozens of host candidates and nobody reads a wall.
   */
  const seen = new Map()
  let relay = false

  probe.createDataChannel('probe')

  const gathered = new Promise(resolve => {
    const done = () => resolve()
    const timer = setTimeout(done, 6000)

    probe.addEventListener('icecandidate', event => {
      const candidate = event.candidate

      if (candidate == null) {
        clearTimeout(timer)
        done()
        return
      }

      if (candidate.type === 'relay') {
        relay = true
      }

      if (candidate.address != null && seen.size < CANDIDATE_LIMIT) {
        const family = candidate.address.includes(':') ? 'v6' : 'v4'
        const key = `${candidate.type}|${candidate.protocol}|${candidate.address}|${candidate.port}`

        if (!seen.has(key)) {
          seen.set(key, {
            type: candidate.type,
            protocol: candidate.protocol ?? null,
            address: candidate.address,
            port: candidate.port ?? null,
            // `.local` is an mDNS name a browser substitutes for the real one,
            // so a page cannot read the machine's address off a candidate. It
            // is not a failure and it is not the VPN: it looks like both.
            family: candidate.address.endsWith('.local') ? 'mdns' : family
          })
        }
      }

      if (candidate.type !== 'srflx' || candidate.address == null) {
        return
      }

      if (isGlobalUnicastV6(candidate.address)) {
        ports.v6.add(candidate.port)
      } else if (!candidate.address.includes(':')) {
        ports.v4.add(candidate.port)
      }
    })
  })

  await probe.setLocalDescription(await probe.createOffer())
  await gathered
  probe.close()

  const ipv4 = relay
    ? { state: 'relay', text: 'IPv4 via the configured TURN relay - should connect from anywhere.' }
    : ports.v4.size === 0
      ? { state: 'blocked', text: 'No IPv4 reflexive candidate - STUN is blocked, or this network is IPv6 only.' }
      : ports.v4.size > 1
        ? { state: 'symmetric', text: 'IPv4 maps a new port per destination (symmetric NAT) - unusable towards a peer elsewhere.' }
        : { state: 'open', text: 'IPv4 mapping stays the same per destination - usable for hole punching.' }

  // A reflexive IPv6 candidate proves the packet reached the STUN server from a
  // routable address. There is no port translation to defeat here; the firewall
  // in front of it is stateful, so the outbound half of ICE opens it just as it
  // would a NAT binding.
  // "blocked" is an observation about this browser, not a verdict on the
  // network. Whether an IPv6 reflexive candidate appears depends on the browser
  // build and its WebRTC IP-handling policy as much as on the route: the same
  // phone on the same Wi-Fi can gather one in one browser and not in another.
  // So the text does not claim the network is IPv4-only - it says what was seen.
  // Three ways to have no reflexive IPv6, and they call for different actions.
  // The candidates already gathered say which one it is, at no extra cost and
  // without asking anyone: a device that offered a global IPv6 *host* candidate
  // has global IPv6, so the missing answer is about the path or the browser and
  // not about the address. Where host candidates arrive as mDNS stand-ins there
  // is nothing to read, and the old ambiguous sentence is still the honest one.
  const candidates = [...seen.values()]
  const hasGlobalV6Host = candidates.some(c => c.type === 'host' && isGlobalUnicastV6(c.address))
  const hasMdnsHost = candidates.some(c => c.family === 'mdns')

  const ipv6 = ports.v6.size > 0
    ? { state: 'open', text: 'Global IPv6 confirmed by STUN - no NAT in the way on this family.' }
    : hasGlobalV6Host
      ? {
          state: 'unproven',
          text: 'This device holds a global IPv6 address, and a peer will be offered it. What could not be shown is whether anything reaches it: no STUN server answered over IPv6. That is either IPv6 UDP not leaving this network at all - in which case it will not work, because WebRTC itself runs over UDP and not only its address discovery - or those particular servers being unreachable over IPv6 while everything else is fine. The two look identical from here, so the address is offered and the claim is not made.'
        }
      : hasMdnsHost
        ? { state: 'blocked', text: 'No IPv6 reflexive candidate from this browser, and its host addresses are hidden behind mDNS stand-ins, so whether this device has IPv6 at all cannot be read here. Another browser on the same network can differ.' }
        : { state: 'blocked', text: 'No IPv6 at all was seen from this browser - no global address on the device and nothing back from a STUN server.' }

  return { ipv4, ipv6, overall: summariseNetwork(ipv4, ipv6), candidates }
}

/**
 * Whether this browser can do WebRTC at all.
 *
 * Cheap and side-effect free, and worth asking before anything else: a browser
 * without it fails every later check for a reason that has nothing to do with
 * the network. Playwright's WebKit build for Linux is the case that makes this
 * more than theoretical.
 */
export function probeBrowser () {
  if (typeof RTCPeerConnection !== 'function') {
    return { state: 'blocked', text: 'This browser has no WebRTC. Nothing here can connect.' }
  }

  // A peer connection that cannot open a data channel is no use either, and
  // that is a separate capability rather than a given.
  try {
    const probe = new RTCPeerConnection({ iceServers: [] })
    const channel = probe.createDataChannel('probe', { negotiated: true, id: 1023 })

    channel.close()
    probe.close()
  } catch (error) {
    return { state: 'blocked', text: `WebRTC data channels are unavailable: ${error.message}` }
  }

  return { state: 'open', text: 'WebRTC and data channels are available.' }
}

/**
 * Whether the camera is usable, without asking for it.
 *
 * Deliberately does not call `getUserMedia`: a readiness panel that triggers a
 * permission prompt has made a decision on the user's behalf. The Permissions
 * API answers the question passively, and "not asked yet" is a normal state
 * rather than a fault - which is why it is amber and not red.
 */
export async function probeCamera () {
  if (navigator.mediaDevices?.getUserMedia == null) {
    return { state: 'blocked', text: 'This browser offers no camera access. Codes can still be pasted.' }
  }

  try {
    const permission = await navigator.permissions?.query({ name: 'camera' })

    if (permission?.state === 'granted') {
      return { state: 'open', text: 'Camera access is granted.' }
    }

    if (permission?.state === 'denied') {
      return { state: 'blocked', text: 'Camera access is blocked. Codes can still be pasted.' }
    }
  } catch {
    // Firefox rejects a camera permission query outright rather than answering
    // it, so an unknown answer is the normal case here and not a failure.
  }

  return { state: 'symmetric', text: 'Camera not asked for yet - scanning will request it.' }
}

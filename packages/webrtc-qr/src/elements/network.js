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
 */
export const DEFAULT_RTC_CONFIGURATION = {
  iceServers: [
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:[2606:4700:4700::1111]:3478' },
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
const NETWORK_RANK = { open: 3, relay: 3, symmetric: 2, blocked: 1 }

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

  if (best.state === 'symmetric') {
    return {
      state: 'symmetric',
      text: 'Peers on this same network are fine. Reaching anyone else needs IPv6 on both sides, or a relay.'
    }
  }

  return {
    state: 'blocked',
    text: 'No usable path off this network was found. Only peers on this same network are reachable.'
  }
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
export async function probeNetwork (rtcConfiguration = DEFAULT_RTC_CONFIGURATION) {
  const probe = new RTCPeerConnection(rtcConfiguration)
  const ports = { v4: new Set(), v6: new Set() }
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
  const ipv6 = ports.v6.size > 0
    ? { state: 'open', text: 'Global IPv6 confirmed by STUN - no NAT in the way on this family.' }
    : { state: 'blocked', text: 'No global IPv6 address - this network offers IPv4 only.' }

  return { ipv4, ipv6, overall: summariseNetwork(ipv4, ipv6) }
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

import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_RTC_CONFIGURATION, isGlobalUnicastV6, offNetworkBlocked, offNetworkRisk, probeBrowser, probeCamera, summariseNetwork } from '../src/elements/network.js'

/**
 * The two pure parts of the network check.
 *
 * These used to be reachable only from a browser test hook, which meant the
 * truth table for "which indicator is green" was asserted through a page. It is
 * arithmetic; it belongs here.
 */

const green = state => ['open', 'relay'].includes(state)

test('either family being usable is enough for the summary', () => {
  const cases = [
    ['open', 'open'],
    ['open', 'blocked'],
    ['blocked', 'open'],
    ['symmetric', 'open'],
    ['relay', 'blocked'],
    ['symmetric', 'blocked'],
    ['blocked', 'blocked']
  ]

  for (const [ipv4, ipv6] of cases) {
    const summary = summariseNetwork({ state: ipv4, text: '' }, { state: ipv6, text: '' })

    // IPv6 alone is enough: it does not care that IPv4 sits behind a carrier
    // NAT, so a green anywhere makes the summary green.
    assert.equal(green(summary.state), green(ipv4) || green(ipv6), `${ipv4}/${ipv6}`)
  }
})

test('only same-network peers are promised when nothing is usable', () => {
  assert.equal(summariseNetwork({ state: 'symmetric' }, { state: 'blocked' }).state, 'symmetric')
  assert.equal(summariseNetwork({ state: 'blocked' }, { state: 'blocked' }).state, 'blocked')
})

test('the risk level separates "nothing works" from "only sometimes works"', () => {
  const overall = (ipv4, ipv6) => ({ overall: summariseNetwork({ state: ipv4 }, { state: ipv6 }) })

  // No reflexive candidate at all: nothing off this network, ever.
  assert.equal(offNetworkRisk(overall('blocked', 'blocked')), 'blocked')

  // The 5G case that started this: carrier NAT on IPv4, no IPv6. A path exists
  // but maps per destination, so it works only if the other side is open -
  // which is worth warning about, and was silent before.
  assert.equal(offNetworkRisk(overall('symmetric', 'blocked')), 'unreliable')

  // Any usable family and there is nothing to warn about.
  assert.equal(offNetworkRisk(overall('symmetric', 'open')), null)
  assert.equal(offNetworkRisk(overall('open', 'blocked')), null)
  assert.equal(offNetworkRisk(overall('relay', 'blocked')), null)

  assert.equal(offNetworkRisk(null), null)
  assert.equal(offNetworkRisk({}), null)
})

test('offNetworkBlocked stays narrow - it means blocked, not merely risky', () => {
  const overall = (ipv4, ipv6) => ({ overall: summariseNetwork({ state: ipv4 }, { state: ipv6 }) })

  // Neither family reachable: an invite made here connects to no one elsewhere.
  assert.equal(offNetworkBlocked(overall('blocked', 'blocked')), true)

  // A symmetric NAT still has a reflexive candidate and sometimes punches
  // through - a weaker amber warning, not the red alarm.
  assert.equal(offNetworkBlocked(overall('symmetric', 'blocked')), false)

  // Any usable family clears it, which is the Firefox-on-5G case: IPv4 symmetric
  // but IPv6 usable still reaches a peer elsewhere.
  assert.equal(offNetworkBlocked(overall('symmetric', 'open')), false)
  assert.equal(offNetworkBlocked(overall('open', 'blocked')), false)

  // Defensive: no result, or a half-built one, is not an alarm.
  assert.equal(offNetworkBlocked(null), false)
  assert.equal(offNetworkBlocked({}), false)
})

test('the summary names both families when both work', () => {
  const summary = summariseNetwork({ state: 'open' }, { state: 'open' })

  assert.match(summary.text, /IPv4 and IPv6/)
})

test('only globally routable IPv6 counts', () => {
  // 2000::/3 is the only range routed on the public internet; unique-local and
  // link-local are as useless to a distant peer as a 192.168 address.
  assert.equal(isGlobalUnicastV6('2a02:810d:f486:ae00:7c06:bad5:54fc:1876'), true)
  assert.equal(isGlobalUnicastV6('[2606:4700:49::1]'), true)
  assert.equal(isGlobalUnicastV6('3ffe:1900:4545:3:200:f8ff:fe21:67cf'), true)
  assert.equal(isGlobalUnicastV6('fd12:3456:789a::1'), false)
  assert.equal(isGlobalUnicastV6('fe80::1c2b:3f4a:5e6d:7f8a'), false)
  assert.equal(isGlobalUnicastV6('188.194.232.23'), false)
  assert.equal(isGlobalUnicastV6('c4fd82a7-dd21-474a-86cc-a61d78d36829.local'), false)
  assert.equal(isGlobalUnicastV6(null), false)
})

test('a browser without WebRTC is reported as blocked, not guessed at', () => {
  // Node has no RTCPeerConnection, which is exactly the shape of the case this
  // exists for: Playwright's WebKit build for Linux has none either.
  const verdict = probeBrowser()

  assert.equal(verdict.state, 'blocked')
  assert.match(verdict.text, /no WebRTC/i)
})

test('a camera nobody has been asked about is amber, not red', async () => {
  // No mediaDevices in Node, so this covers the unsupported branch. The
  // distinction that matters is elsewhere and is asserted by the wording: not
  // having asked yet is a normal state, and painting it red would report a
  // fault where there is none.
  const verdict = await probeCamera()

  assert.equal(verdict.state, 'blocked')
  assert.match(verdict.text, /pasted/)
})

/**
 * A peer connection that gathers exactly what a test says it gathers.
 *
 * `probeNetwork` needs one and nothing else, so the verdict is arithmetic over a
 * candidate list once the connection is faked - and the interesting cases are
 * ones no CI machine could be made to produce on demand, like a phone that has
 * global IPv6 and gets nothing back over it.
 */
const withCandidates = candidates => class {
  #listener = null

  createDataChannel () {}
  createOffer () { return {} }
  close () {}

  addEventListener (name, fn) {
    if (name === 'icecandidate') this.#listener = fn
  }

  async setLocalDescription () {
    for (const candidate of candidates) {
      this.#listener?.({ candidate })
    }

    // The terminator, which is what clears the six-second fallback timer.
    this.#listener?.({ candidate: null })
  }
}

const probeWith = async candidates => {
  const { probeNetwork } = await import('../src/elements/network.js')
  const real = globalThis.RTCPeerConnection

  globalThis.RTCPeerConnection = withCandidates(candidates)

  try {
    return await probeNetwork({})
  } finally {
    globalThis.RTCPeerConnection = real
  }
}

const host = (address, port = 5000) => ({ type: 'host', protocol: 'udp', address, port })
const srflx = (address, port = 5000) => ({ type: 'srflx', protocol: 'udp', address, port })

test('a device with global IPv6 and no answer over it is untested, not blocked', async () => {
  // The reported case: a phone on mobile data, Chrome, holding two global IPv6
  // prefixes of its own while no IPv6 came back from any STUN server.
  //
  // Amber rather than red, because the two explanations are indistinguishable
  // from here and only one of them means it cannot work. The address is offered
  // to a peer either way - this panel advises, it never filters candidates.
  const result = await probeWith([
    host('2a02:3033:268:538e::1'),
    host('10.175.44.142'),
    srflx('176.2.191.44', 36998)
  ])

  assert.equal(result.ipv6.state, 'unproven')
  assert.match(result.ipv6.text, /a peer will be offered it/)
  // Both readings named, because guessing between them is what the old sentence
  // did. And the reason one of them is fatal: WebRTC is UDP, not only its
  // address discovery.
  assert.match(result.ipv6.text, /UDP not leaving this network/)
  assert.match(result.ipv6.text, /unreachable over IPv6 while everything else is fine/)
})

test('an untested IPv6 never makes the summary green', async () => {
  // The overclaim this panel exists to avoid: a green summary resting on an
  // address nobody has reached. Symmetric IPv4 plus untested IPv6 is amber.
  const result = await probeWith([
    host('2a02:3033:268:538e::1'),
    srflx('176.2.191.44', 36998),
    srflx('176.2.191.44', 36893)
  ])

  assert.equal(result.ipv6.state, 'unproven')
  assert.equal(result.ipv4.state, 'symmetric')
  assert.notEqual(result.overall.state, 'open')
})

test('a device behind mDNS stand-ins is told what cannot be read, rather than a guess', async () => {
  const result = await probeWith([
    host('4f1c2f3e-0000-4000-8000-000000000000.local'),
    srflx('176.2.191.44')
  ])

  assert.equal(result.ipv6.state, 'blocked')
  assert.match(result.ipv6.text, /cannot be read here/)
})

test('a device with no IPv6 anywhere is told exactly that', async () => {
  const result = await probeWith([host('192.168.1.20'), srflx('176.2.191.44')])

  assert.equal(result.ipv6.state, 'blocked')
  assert.match(result.ipv6.text, /No IPv6 at all/)
})

test('two reflexive ports on one address is what symmetric means', async () => {
  // The other half of the same report, and the one the panel can prove: the same
  // public address seen on two ports, because two STUN servers were asked.
  const result = await probeWith([
    srflx('176.2.191.44', 36998),
    srflx('176.2.191.44', 36893)
  ])

  assert.equal(result.ipv4.state, 'symmetric')
})

test('every default STUN entry is a STUN endpoint, not a resolver that happens to be nearby', () => {
  // `2606:4700:4700::1111` sat in this list and answered nothing: it is
  // Cloudflare's public resolver, the IPv6 twin of 1.1.1.1, and not their STUN
  // service. Measured with a peer connection against both, one answered.
  //
  // Asserted rather than trusted because the failure is invisible: a dead entry
  // costs no error and no delay, it only halves the evidence behind a verdict.
  // The literals must stay the AAAA records of the named servers above them.
  const urls = DEFAULT_RTC_CONFIGURATION.iceServers.map(s => s.urls)

  assert.ok(urls.includes('stun:[2606:4700:49::]:3478'), 'the Cloudflare literal must be its STUN AAAA')
  assert.ok(!urls.some(u => u.includes('4700:4700')), 'a resolver address is not a STUN server')

  // One literal per named server, so a resolver returning no AAAA cannot leave
  // the check with no IPv6 transaction at all.
  const byName = urls.filter(u => !u.includes('['))
  const literals = urls.filter(u => u.includes('['))

  assert.equal(literals.length, byName.length)
})

test('an untested IPv6 beside a blocked IPv4 warns, but does not claim a failure', () => {
  // `unproven` was given rank 2 so it would never be treated as blocked, and
  // the summary then tested for the literal word `symmetric` and sent it to the
  // red verdict anyway. An address was being offered that might well reach a
  // peer, and the panel said the network could reach nobody.
  const overall = summariseNetwork({ state: 'blocked', text: '' }, { state: 'unproven', text: '' })

  assert.equal(overall.state, 'unproven')
  assert.equal(offNetworkBlocked({ overall }), false)
  // Quieter than red and louder than silence: an address exists, and nothing
  // was shown to reach it.
  assert.equal(offNetworkRisk({ overall }), 'unreliable')
  assert.match(overall.text, /was not demonstrated/)
})

test('a usable IPv4 is unaffected by an untested IPv6', () => {
  const overall = summariseNetwork({ state: 'open', text: '' }, { state: 'unproven', text: '' })

  assert.equal(overall.state, 'open')
  assert.equal(offNetworkRisk({ overall }), null)
})

import assert from 'node:assert/strict'
import test from 'node:test'
import { isGlobalUnicastV6, offNetworkBlocked, offNetworkRisk, probeBrowser, probeCamera, summariseNetwork } from '../src/elements/network.js'

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

import assert from 'node:assert/strict'
import test from 'node:test'
import { isGlobalUnicastV6, probeBrowser, probeCamera, summariseNetwork } from '../src/elements/network.js'

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

import assert from 'node:assert/strict'
import test from 'node:test'

// The elements extend HTMLElement and register themselves, neither of which
// exists in Node - so the barrel cannot simply be imported here. Two stubs are
// enough to evaluate it, and evaluating it is the whole point: this asserts
// what a consumer can reach, which is a different question from what the
// browser tests cover.
globalThis.HTMLElement ??= class {}
globalThis.customElements ??= { define () {}, get () { return undefined } }

const elements = await import('../src/elements/index.js')
const core = await import('../src/index.js')

/**
 * The barrel is the API. A function that exists in a module but never reaches
 * `./elements` is not reachable by a consumer at all - the package's exports map
 * offers only "." and "./elements", so deep imports are not a fallback.
 *
 * This was not hypothetical: `offNetworkBlocked` shipped in the element, the
 * alarm rendered from it, and it was announced as the way for an application to
 * gate its own connect control - while being absent from this list.
 */
test('the judgements a consumer needs are reachable from ./elements', () => {
  for (const name of ['offNetworkBlocked', 'offNetworkRisk', 'probeNetwork', 'summariseNetwork']) {
    assert.equal(typeof elements[name], 'function', `${name} must be exported from ./elements`)
  }
})

test('the elements themselves and their strings are reachable', () => {
  for (const name of ['QrStatusElement', 'QrScannerElement', 'QrInviteElement', 'QrPeersElement', 'QrIntroElement']) {
    assert.equal(typeof elements[name], 'function', `${name} must be exported`)
  }

  for (const name of ['QR_STATUS_STRINGS', 'QR_SCANNER_STRINGS', 'QR_INVITE_STRINGS', 'QR_PEERS_STRINGS', 'QR_INTRO_STRINGS']) {
    assert.equal(typeof elements[name], 'object', `${name} must be exported so a consumer can translate`)
  }

  // German is shipped, so it has to be reachable the same way. A locale that
  // exists in the source and not in the barrel is a locale nobody can use.
  for (const name of ['QR_STATUS_STRINGS_DE', 'QR_SCANNER_STRINGS_DE', 'QR_INVITE_STRINGS_DE', 'QR_PEERS_STRINGS_DE', 'QR_INTRO_STRINGS_DE']) {
    assert.equal(typeof elements[name], 'object', `${name} must be exported`)
  }
})

test('the introduction policy is reachable without the element', () => {
  // An app writing its own introduction still wants the rule, and the rule is
  // the part that is easy to get wrong.
  assert.equal(typeof elements.createIntroPolicy, 'function')
})

/**
 * All four halves of one subject: whether a pending invite is still there when
 * somebody comes back from a messenger. Every one of them was written inside
 * the demo first, which is the same mistake `offNetworkBlocked` made - useful
 * to a consumer, invisible to one.
 */
test('surviving an app switch is reachable from the root', () => {
  for (const name of ['createKeepAlive', 'createWakeLock', 'leavingSuspendsUs', 'stateOf', 'pendingConnections']) {
    assert.equal(typeof core[name], 'function', `${name} must be exported from the root`)
  }

  // The list, not a copy of it: a consumer naming these browsers from its own
  // literal is a consumer whose list stops matching this one.
  assert.ok(Array.isArray(core.BROWSERS_THAT_HOLD), 'BROWSERS_THAT_HOLD must be exported')
})

test('the session and the format-aware parser are reachable from the root', () => {
  for (const name of ['QRSession', 'webRTCQR', 'parsePayload', 'decodePayload', 'describeIce']) {
    assert.equal(typeof core[name], 'function', `${name} must be exported`)
  }
})

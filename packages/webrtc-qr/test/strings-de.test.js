import assert from 'node:assert/strict'
import test from 'node:test'

// The English tables live inside the element modules, which extend HTMLElement
// and register themselves - so reaching them in Node needs the stubs, and the
// imports have to be dynamic because a static one would hoist above them.
// `strings-de.js` needs none of this: it is data, and the JSDoc types that tie
// it to the elements are erased.
globalThis.HTMLElement ??= class {}
globalThis.customElements ??= { define () {}, get () { return undefined } }

const { QR_INVITE_STRINGS } = await import('../src/elements/qr-invite.js')
const { QR_PEERS_STRINGS } = await import('../src/elements/qr-peers.js')
const { QR_SCANNER_STRINGS } = await import('../src/elements/qr-scanner.js')
const { QR_STATUS_STRINGS } = await import('../src/elements/qr-status.js')
const {
  QR_INVITE_STRINGS_DE,
  QR_PEERS_STRINGS_DE,
  QR_SCANNER_STRINGS_DE,
  QR_STATUS_STRINGS_DE
} = await import('../src/elements/strings-de.js')

/**
 * A second locale rots differently from a README.
 *
 * `mergeStrings` folds a partial table over the defaults, which is exactly what
 * makes a missing German key invisible: the English falls through and the
 * screen still reads as finished. So the drift has to be asserted rather than
 * noticed - a string added to an element upstream must fail here until somebody
 * translates it.
 */

const PAIRS = [
  ['status', QR_STATUS_STRINGS, QR_STATUS_STRINGS_DE],
  ['scanner', QR_SCANNER_STRINGS, QR_SCANNER_STRINGS_DE],
  ['invite', QR_INVITE_STRINGS, QR_INVITE_STRINGS_DE],
  ['peers', QR_PEERS_STRINGS, QR_PEERS_STRINGS_DE]
]

for (const [name, en, de] of PAIRS) {
  test(`the German ${name} table carries exactly the English keys`, () => {
    assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort())
  })

  test(`every German ${name} entry has the shape its English counterpart has`, () => {
    // A function where a string was expected is called with parameters it does
    // not take; a string where a function was expected silently drops the
    // number it was supposed to carry - "Part 3 of 6" becoming "Part".
    for (const key of Object.keys(en)) {
      assert.equal(typeof de[key], typeof en[key], `${name}.${key}`)
    }
  })

  test(`no ${name} entry was left in English`, () => {
    // Copying the English table and translating half of it is the likely way
    // this goes wrong, and it produces a file that passes both tests above.
    const same = Object.keys(en).filter(key =>
      typeof en[key] === 'string' && en[key] === de[key] &&
      // Proper nouns and protocol names are the same word in both languages,
      // and translating them would be worse than leaving them.
      !['Browser', 'IPv4', 'IPv6'].includes(en[key]))

    assert.deepEqual(same, [], 'identical to the English')
  })
}

test('the functions produce German, and place the numbers themselves', () => {
  // The whole reason these are functions rather than templates: word order is
  // not universal, so a consumer's language decides where the count goes.
  assert.match(QR_SCANNER_STRINGS_DE.stillLooking({ attempts: 12 }), /12 Versuche/)
  assert.match(QR_SCANNER_STRINGS_DE.animated({ received: 3, total: 6 }), /Teil 3 von 6/)
  assert.match(QR_INVITE_STRINGS_DE.part({ slot: 2, total: 5 }), /Teil 2 von 5/)
  assert.match(QR_PEERS_STRINGS_DE.disconnectFrom({ peerId: '12D3Koo' }), /12D3Koo/)
})

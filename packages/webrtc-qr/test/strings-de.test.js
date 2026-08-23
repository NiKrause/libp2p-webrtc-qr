import assert from 'node:assert/strict'
import test from 'node:test'

const { resolveText } = await import('../src/elements/strings.js')

// The English tables live inside the element modules, which extend HTMLElement
// and register themselves - so reaching them in Node needs the stubs, and the
// imports have to be dynamic because a static one would hoist above them.
// `strings-de.js` needs none of this: it is data, and the JSDoc types that tie
// it to the elements are erased.
globalThis.HTMLElement ??= class {}
globalThis.customElements ??= { define () {}, get () { return undefined } }

const { QR_INTRO_STRINGS } = await import('../src/elements/qr-intro.js')
const { QR_INVITE_STRINGS } = await import('../src/elements/qr-invite.js')
const { QR_LISTEN_STRINGS } = await import('../src/elements/qr-listen.js')
const { QR_PEERS_STRINGS } = await import('../src/elements/qr-peers.js')
const { QR_SCANNER_STRINGS } = await import('../src/elements/qr-scanner.js')
const { QR_STATUS_STRINGS } = await import('../src/elements/qr-status.js')
const {
  QR_INTRO_STRINGS_DE,
  QR_INVITE_STRINGS_DE,
  QR_LISTEN_STRINGS_DE,
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
  ['peers', QR_PEERS_STRINGS, QR_PEERS_STRINGS_DE],
  ['intro', QR_INTRO_STRINGS, QR_INTRO_STRINGS_DE],
  ['listen', QR_LISTEN_STRINGS, QR_LISTEN_STRINGS_DE]
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
    //
    // Proper nouns and protocol names are the same word in both languages, and
    // translating them would be worse than leaving them.
    const SHARED = ['Browser', 'IPv4', 'IPv6']
    const untranslated = value => typeof value === 'string' && !SHARED.includes(value)

    const same = Object.keys(en).filter(key => {
      // Arrays carry the longest prose in these tables - the intro's list of
      // caveats is four sentences - so leaving one behind is both the easiest
      // mistake and the most visible one.
      if (Array.isArray(en[key])) {
        return en[key].some((line, i) => untranslated(line) && line === de[key]?.[i])
      }

      return untranslated(en[key]) && en[key] === de[key]
    })

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

test('the relay counts read correctly at one and at many, in both locales', () => {
  // These are functions rather than templates because word order is not
  // universal — and a function is exactly where an off-by-one plural hides:
  // nothing fails, the line just reads wrong to the one reader who has one.
  const cases = [
    ['en', QR_INTRO_STRINGS],
    ['de', QR_INTRO_STRINGS_DE]
  ]

  for (const [locale, table] of cases) {
    for (const key of ['relayReachable', 'relayDiscovered']) {
      const one = resolveText(table[key], { count: 1 })
      const many = resolveText(table[key], { count: 4 })

      assert.notEqual(one, many, `${locale}.${key} reads the same for 1 and 4`)
      assert.match(many, /\b4\b/, `${locale}.${key} must name the count when there are several`)
      assert.doesNotMatch(one, /\b1s\b|\b1 relays\b|1 Relays/, `${locale}.${key} pluralises a single relay`)
    }
  }
})

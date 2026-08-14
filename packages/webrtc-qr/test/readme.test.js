import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The elements register themselves against a DOM that Node does not have.
globalThis.HTMLElement ??= class {}
globalThis.customElements ??= { define () {}, get () { return undefined } }

const elements = await import('../src/elements/index.js')
const core = await import('../src/index.js')
const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8')

/**
 * The package README is what npm shows, and it is the only thing a consumer
 * arriving from there can read. Three features shipped in a week once and the
 * documentation followed none of them - `strings`, the whole i18n seam, was the
 * headline of 0.7.0 and appeared in no README at all.
 *
 * Remembering is not a mechanism. These assert it instead.
 */

test('every export is named in the README', () => {
  const missing = [...Object.keys(core), ...Object.keys(elements)]
    .filter(name => !readme.includes(name))

  assert.deepEqual(missing, [], 'exported but undocumented')
})

test('every translatable string key is named in the README', () => {
  const missing = []

  for (const table of ['QR_STATUS_STRINGS', 'QR_SCANNER_STRINGS', 'QR_INVITE_STRINGS', 'QR_PEERS_STRINGS']) {
    for (const key of Object.keys(elements[table])) {
      // A consumer translating an element needs the list of keys; a key absent
      // here is one they will only find by reading the source.
      if (!readme.includes(key)) {
        missing.push(`${table}.${key}`)
      }
    }
  }

  assert.deepEqual(missing, [], 'translatable but undocumented')
})

test('the README says which import path each half comes from', () => {
  // Deep imports are not supported, so a reader who does not know which of the
  // two entry points holds a symbol cannot import it at all.
  assert.match(readme, /@le-space\/libp2p-webrtc-qr\/elements/)
  assert.match(readme, /Deep imports are not supported/)
})

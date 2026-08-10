// The seam the elements use for their text (#51).
//
// The elements themselves extend HTMLElement and cannot be imported here, so
// the real tables are exercised against a live element in the browser suite.
// What this file covers is the part that fails *quietly*: the merge. Get that
// wrong and a consumer translates one row, the others go blank, and nothing
// throws.

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mergeStrings, resolveText } from '../src/elements/strings.js'

/** Stands in for a real table; frozen so the assertions are about the merge. */
const DEFAULTS = Object.freeze({
  browser: 'Browser',
  ipv4: 'IPv4',
  ipv6: 'IPv6',
  camera: 'Camera',
  overall: 'Result'
})

test('translating one entry keeps the rest', () => {
  const merged = mergeStrings(DEFAULTS, { camera: 'Kamera' })

  assert.equal(merged.camera, 'Kamera')
  assert.equal(merged.browser, 'Browser')
  assert.equal(merged.overall, 'Result')
})

test('a string added upstream survives a table written before it existed', () => {
  // The reason this is a merge rather than a replace: an app pinned to an older
  // table would otherwise blank every string added after it was written.
  const merged = mergeStrings({ ...DEFAULTS, futureRow: 'Something new' }, { camera: 'Kamera' })

  assert.equal(merged.futureRow, 'Something new')
})

test('null and undefined fall back rather than blanking the text', () => {
  // An empty row reads as broken, not as translated, so clearing is treated as
  // "I have nothing to say about this one".
  const merged = mergeStrings(DEFAULTS, { camera: null, browser: undefined })

  assert.equal(merged.camera, 'Camera')
  assert.equal(merged.browser, 'Browser')
})

test('passing nothing leaves the defaults untouched', () => {
  assert.deepEqual(mergeStrings(DEFAULTS, null), DEFAULTS)
  assert.deepEqual(mergeStrings(DEFAULTS, undefined), DEFAULTS)
})

test('the merge does not write into the defaults', () => {
  // A consumer translating one element must not change what a second element on
  // the same page starts from.
  mergeStrings(DEFAULTS, { camera: 'Kamera' })

  assert.equal(DEFAULTS.camera, 'Camera')
})

test('an entry that carries numbers is called with them', () => {
  const value = ({ received, total }) => `${received}/${total}`

  assert.equal(resolveText(value, { received: 3, total: 6 }), '3/6')
})

test('a plain string where a function was expected is used verbatim', () => {
  // A fixed caption is a choice, not a failure. Throwing here would take a
  // screen down over a caption.
  assert.equal(resolveText('Halte still', { received: 3 }), 'Halte still')
})

test('a missing entry is empty rather than the word "undefined"', () => {
  assert.equal(resolveText(undefined), '')
  assert.equal(resolveText(null), '')
})

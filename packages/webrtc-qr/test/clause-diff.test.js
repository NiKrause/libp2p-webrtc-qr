import assert from 'node:assert/strict'
import test from 'node:test'

import { changedClauses } from '../src/elements/clause-diff.js'

test('the first paint marks nothing', () => {
  // Everything is new then. A statement that flashes in full on arrival tells
  // nobody which line their choice moved.
  assert.deepEqual(changedClauses([], ['a', 'b', 'c']), [])
})

test('a repaint with the same sentences marks nothing', () => {
  // Repaints are frequent - every `strings`, `choices` or `technical`
  // assignment causes one - and only a change in the sentences is worth
  // showing.
  assert.deepEqual(changedClauses(['a', 'b'], ['a', 'b']), [])
})

test('a rewritten line is marked, and its neighbours are not', () => {
  assert.deepEqual(changedClauses(['a', 'relay on', 'c'], ['a', 'relay off', 'c']), [1])
})

test('two switches in one repaint mark both lines', () => {
  const before = ['a', 'relay on', 'persistent', 'z']
  const after = ['a', 'relay off', 'memory', 'z']
  assert.deepEqual(changedClauses(before, after), [1, 2])
})

test('a dropped clause does not mark everything after it', () => {
  // The case index comparison gets wrong, and the reason this is a set
  // difference. `qr01` drops its QR sentence when the relay goes on: the list
  // shortens, everything after shifts, and comparing position to position
  // marks lines the reader has already read.
  const before = ['no server', 'a code is carried', 'no relay is contacted', 'local']
  const after = ['no server', 'a relay introduces the two', 'local']
  assert.deepEqual(changedClauses(before, after), [1])
})

test('an added clause is marked', () => {
  assert.deepEqual(changedClauses(['a', 'b'], ['a', 'new', 'b']), [1])
})

test('a clause that only moved is not marked', () => {
  // It is not new to the reader, wherever it now sits.
  assert.deepEqual(changedClauses(['a', 'b'], ['b', 'a']), [])
})

test('an emptied statement marks nothing', () => {
  assert.deepEqual(changedClauses(['a', 'b'], []), [])
})

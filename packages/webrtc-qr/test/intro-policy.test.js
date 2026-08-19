import assert from 'node:assert/strict'
import test from 'node:test'

import { createIntroPolicy } from '../src/elements/intro-policy.js'

/**
 * Three rules, and each one is a decision somebody would otherwise make the
 * other way on a first attempt.
 */

const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial))

  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key),
    get size () { return map.size }
  }
}

test('a first visit gets the introduction', () => {
  const policy = createIntroPolicy({ storage: fakeStorage() })

  assert.equal(policy.shouldOpen(), true)
})

test('a repeat visit does not', () => {
  const storage = fakeStorage()
  const policy = createIntroPolicy({ storage })

  policy.remember()

  assert.equal(policy.shouldOpen(), false)
})

test('arriving by invite suppresses it, even on a first visit', () => {
  // The one people get wrong. Somebody who followed a link came to accept
  // something, and a dialog in front of that is in the way of the only thing
  // they came for. They see it on their next plain visit - which is why this
  // does not also mark it seen.
  const storage = fakeStorage()
  const policy = createIntroPolicy({ storage })

  assert.equal(policy.shouldOpen({ arrivedViaInvite: true }), false)
  assert.equal(policy.shouldOpen(), true)
  assert.equal(storage.size, 0, 'suppressing must not count as having seen it')
})

test('blocked storage shows it rather than hiding it', () => {
  // An introduction seen twice is a smaller problem than a first-time user who
  // never gets one, so every failure here leans towards showing.
  const throwing = {
    getItem () { throw new Error('denied') },
    setItem () { throw new Error('denied') },
    removeItem () { throw new Error('denied') }
  }
  const policy = createIntroPolicy({ storage: throwing })

  assert.equal(policy.shouldOpen(), true)
  assert.doesNotThrow(() => policy.remember())
  assert.equal(policy.shouldOpen(), true)
})

test('absent storage is survivable', () => {
  // `localStorage` does not exist while a page is being prerendered.
  const policy = createIntroPolicy({ storage: undefined })
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true })

  try {
    assert.equal(policy.shouldOpen(), true)
    assert.doesNotThrow(() => policy.remember())
  } finally {
    if (saved == null) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', saved)
  }
})

test('dismissing is not a one-way door', () => {
  const policy = createIntroPolicy({ storage: fakeStorage() })

  policy.remember()
  policy.forget()

  assert.equal(policy.shouldOpen(), true)
})

test('two apps on one origin do not share a decision', () => {
  const storage = fakeStorage()
  const one = createIntroPolicy({ storageKey: 'one.introSeen', storage })
  const other = createIntroPolicy({ storageKey: 'other.introSeen', storage })

  one.remember()

  assert.equal(one.shouldOpen(), false)
  assert.equal(other.shouldOpen(), true)
})

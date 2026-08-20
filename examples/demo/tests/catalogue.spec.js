import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import de from '../locales/de.js'
import en from '../locales/en.js'

/**
 * The markup names keys; the catalogues hold words. Nothing checked that the
 * two agreed.
 *
 * Comparing the catalogues against *each other* is the obvious check and it is
 * the one that misses this: a key absent from both is missing consistently, and
 * both files still match. What that produces on screen is the key itself -
 * `step.start.heading` where a heading should be - and it took a browser to
 * notice.
 *
 * `t()` falls back to the key on purpose: blank text reads as a finished screen
 * with nothing to say, while a visible key reads as the bug it is and names
 * itself. That is the right behaviour in production and useless as a guard,
 * because nobody looks at every panel in both languages.
 */

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8')

const keysInMarkup = () => {
  const named = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map(m => m[1])
  const inAttributes = [...html.matchAll(/data-i18n-attr="([^"]+)"/g)]
    .flatMap(m => m[1].split(',').map(pair => pair.split(':')[1]?.trim()))
    .filter(Boolean)

  return [...new Set([...named, ...inAttributes])]
}

const lookup = (catalogue, key) => key.split('.').reduce((node, part) => node?.[part], catalogue)

const flatten = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? flatten(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])

test.describe('the catalogues', () => {
  test('every key the markup names exists in English', () => {
    const missing = keysInMarkup().filter(key => lookup(en, key) == null)

    expect(missing, 'named in index.html, absent from locales/en.js').toEqual([])
  })

  test('every key the markup names exists in German', () => {
    const missing = keysInMarkup().filter(key => lookup(de, key) == null)

    expect(missing, 'named in index.html, absent from locales/de.js').toEqual([])
  })

  test('the two catalogues carry the same keys', () => {
    // Still worth asserting separately: a key used only from JavaScript never
    // appears in the markup, so the two checks above would not see it fall
    // behind in one language.
    expect(flatten(de).sort()).toEqual(flatten(en).sort())
  })

  test('no German entry was left in English', () => {
    // Copying the file and translating most of it is the likely way this goes
    // wrong, and it passes every check above.
    const shared = ['English', 'Deutsch', 'libp2p WebRTC over QR']
    const same = flatten(en).filter(key => {
      const value = lookup(en, key)
      return typeof value === 'string' && value === lookup(de, key) && !shared.includes(value)
    })

    expect(same, 'identical to the English').toEqual([])
  })
})

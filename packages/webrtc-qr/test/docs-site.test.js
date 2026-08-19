import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The elements register themselves against a DOM that Node does not have.
globalThis.HTMLElement ??= class {}
globalThis.customElements ??= { define () {}, get () { return undefined } }

const elements = await import('../src/elements/index.js')
const core = await import('../src/index.js')

const EN = new URL('../../../docs-site/docs/', import.meta.url)
const DE = new URL('../../../docs-site/i18n/de/docusaurus-plugin-content-docs/current/', import.meta.url)

const pages = dir => readdirSync(fileURLToPath(dir)).filter(name => name.endsWith('.md'))
const read = dir => pages(dir).map(name => readFileSync(new URL(name, dir), 'utf8')).join('\n')

/**
 * `readme.test.js` guards the package README because three features once
 * shipped in a week and the documentation followed none of them. The site went
 * up with no such guard, and `createKeepAlive` was undocumented in both
 * languages within a fortnight - the same failure, one directory over.
 *
 * A second locale adds a failure mode the README does not have: German can fall
 * behind English silently, and a reader who never switches will never notice.
 */

test('every export is named in the English documentation', () => {
  const docs = read(EN)
  const missing = [...Object.keys(core), ...Object.keys(elements)]
    .filter(name => !docs.includes(name))

  assert.deepEqual(missing, [], 'exported but undocumented')
})

test('every export is named in the German documentation', () => {
  const docs = read(DE)
  const missing = [...Object.keys(core), ...Object.keys(elements)]
    .filter(name => !docs.includes(name))

  assert.deepEqual(missing, [], 'documented in English only')
})

test('the two locales cover the same pages', () => {
  // A page translated into neither is a gap; a page translated into one is
  // worse, because the language dropdown then leads somewhere that does not
  // exist and Docusaurus falls back without saying so.
  assert.deepEqual(pages(DE).sort(), pages(EN).sort())
})

test('every page is reachable from the sidebar', () => {
  const sidebar = readFileSync(new URL('../../../docs-site/sidebars.mjs', import.meta.url), 'utf8')
  const unreachable = pages(EN)
    .map(name => name.replace(/\.md$/, ''))
    .filter(id => !sidebar.includes(`'${id}'`))

  // A page nobody links to is a page nobody reads, and it still builds.
  assert.deepEqual(unreachable, [], 'written but unreachable')
})

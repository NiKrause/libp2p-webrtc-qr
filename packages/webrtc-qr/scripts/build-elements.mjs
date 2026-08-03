import { build } from 'esbuild'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Bundle the elements into one browser file with nothing left to resolve.
 *
 * The transport entry point stays plain source - a consumer bundles it like any
 * other dependency and tree-shakes what it does not use. The elements cannot be
 * shipped that way, and the reason is worth stating: `qrcode` and the BC-UR
 * stack are CommonJS and reach for `buffer` and `process`. In an application
 * that already polyfills those - which most libp2p applications do - the same
 * specifier gets resolved one way by the framework's SSR externals and another
 * by the polyfill plugin, and the build fails with a message about externals
 * that never mentions Buffer.
 *
 * A UI layer meant to be dropped into a build we do not control should not hand
 * that build a Node dependency to reason about. So everything is inlined here,
 * including a Buffer shim that is installed only if the host has not got one.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

await build({
  entryPoints: [join(root, 'src/elements/index.js')],
  outfile: join(root, 'dist/elements.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2022'],
  minify: true,
  // Leaves no free `Buffer` identifier for a consumer's polyfill plugin to
  // find and rewrite into an import we cannot satisfy.
  inject: [join(here, 'buffer-inject.js'), join(here, 'process-inject.js')],
  // Node globals the CommonJS dependencies expect. Defined rather than
  // polyfilled, so nothing is added that is not actually reached.
  define: {
    global: 'globalThis'
  },
  legalComments: 'none',
  logLevel: 'warning'
})

// A type declaration is not generated yet, but the entry has to exist for a
// consumer that type-checks its imports.
mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist/elements.d.ts'), "export * from '../src/elements/index.js'\n")

console.log('built dist/elements.js')

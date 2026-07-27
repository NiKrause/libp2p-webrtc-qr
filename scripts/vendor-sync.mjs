#!/usr/bin/env node
/**
 * Re-copies the `@libp2p/webrtc` internals that `packages/webrtc-qr` vendors.
 *
 * Run this after bumping `@libp2p/webrtc` in the dev dependency below, then run
 * the demo e2e suite. See packages/webrtc-qr/src/vendor/README.md for why the
 * copy exists at all.
 */
import { createRequire } from 'node:module'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILES = [
  ['dist/src/muxer.js', 'muxer.js'],
  ['dist/src/stream.js', 'stream.js'],
  ['dist/src/constants.js', 'constants.js'],
  ['dist/src/private-to-public/pb/message.js', 'pb-message.js']
]

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('@libp2p/webrtc/package.json'))
const { version } = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
const vendorDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../packages/webrtc-qr/src/vendor'
)

for (const [from, to] of FILES) {
  const target = resolve(vendorDirectory, to)
  copyFileSync(resolve(packageRoot, from), target)

  const patched = readFileSync(target, 'utf8')
    .replaceAll("'./private-to-public/pb/message.js'", "'./pb-message.js'")
    .replace(/^\/\/# sourceMappingURL=.*$/gm, '')

  writeFileSync(target, patched)
}

console.log(`Vendored ${FILES.length} files from @libp2p/webrtc@${version}.`)
console.log('Update the version noted in packages/webrtc-qr/src/vendor/README.md, then run `pnpm test`.')

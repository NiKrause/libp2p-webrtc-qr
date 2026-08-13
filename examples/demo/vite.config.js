import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

/**
 * Stamp the build into the page.
 *
 * A deployed demo is an anonymous bundle behind a CID: nothing on it says which
 * release it came from, so answering "is the fix live yet?" meant grepping the
 * served HTML for a button label that happened to have changed. The stamp goes
 * into index.html rather than being set from JavaScript, so `curl` answers that
 * question - and so it survives a bundle that fails to boot, which is the build
 * you most need to identify.
 *
 * The version is the *library's*, not the demo's own placeholder 0.1.0. That is
 * what someone comparing this page against their npm install cares about.
 */
const { version } = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../packages/webrtc-qr/package.json', import.meta.url)),
  'utf8'
))

function commit () {
  // Actions builds from a detached HEAD but hands the sha over in the
  // environment. A tree exported without .git still has to build, hence the
  // fallback: an unknown commit is worth less than a real one, not than none.
  if (process.env.GITHUB_SHA != null) {
    return process.env.GITHUB_SHA.slice(0, 7)
  }

  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

// One instant, two renderings - taken from a single Date so they cannot land on
// opposite sides of a minute boundary and disagree.
const builtAt = new Date().toISOString().slice(0, 16)

const stamp = {
  __QR_VERSION__: version,
  // Minutes, UTC. A deploy is identified by which one it is, not by its second,
  // and a local timezone would make two people's screenshots disagree.
  __QR_BUILD_TIME__: `${builtAt.replace('T', ' ')} UTC`,
  // The machine-readable half of <time>, which has to parse as a datetime - the
  // human string with its trailing "UTC" does not.
  __QR_BUILD_ISO__: `${builtAt}Z`,
  __QR_COMMIT__: commit()
}

export default defineConfig({
  plugins: [{
    name: 'build-stamp',
    transformIndexHtml: {
      // Ahead of Vite's own %VAR% pass, so the two substitutions cannot
      // interleave over each other's output.
      order: 'pre',
      handler: html => Object.entries(stamp).reduce(
        (out, [token, value]) => out.replaceAll(token, value),
        html
      )
    }
  }],

  // IPFS gateways serve the app below /ipfs/<cid>/, so assets must be relative.
  base: './',

  // `@ngraveio/bc-ur` and its CBOR and hash dependencies are written for Node
  // and reach for `process` and `Buffer`. These two defines plus the `buffer`
  // package cover everything they touch. `vite-plugin-node-polyfills`, which
  // the Svelte scanner library pulls in for the same reason, would ship a great
  // deal more into a bundle that has to be served off an IPFS gateway.
  define: {
    'process.env': '{}',
    'process.browser': 'true'
  },
  server: {
    port: 5173
  }
})

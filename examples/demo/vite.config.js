import { defineConfig } from 'vite'

export default defineConfig({
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

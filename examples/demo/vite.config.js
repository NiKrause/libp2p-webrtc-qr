import { defineConfig } from 'vite'

export default defineConfig({
  // IPFS gateways serve the app below /ipfs/<cid>/, so assets must be relative.
  base: './',
  server: {
    port: 5173
  }
})

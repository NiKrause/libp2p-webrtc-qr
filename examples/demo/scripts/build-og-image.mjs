#!/usr/bin/env node
/**
 * Renders public/og-image.png, the 1200x630 card that link previews show.
 *
 * Checked in rather than generated at build time, because a social card should
 * only change when someone decides it should. Re-run with:
 *
 *   pnpm --filter @le-space/libp2p-webrtc-qr-demo og-image
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import QRCode from 'qrcode'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/og-image.png')

// A real, scannable code rather than a decorative pattern - it resolves to the
// demo, so the card works even when someone points a phone at a screenshot.
const qr = await QRCode.toDataURL('https://webrtc-qr.le-space.de', {
  errorCorrectionLevel: 'M',
  margin: 2,
  width: 640,
  color: { dark: '#0b0e15', light: '#ffffff' }
})

const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      * { box-sizing: border-box; margin: 0; }
      body {
        width: 1200px;
        height: 630px;
        display: flex;
        align-items: center;
        gap: 64px;
        padding: 0 72px;
        background:
          radial-gradient(ellipse 70% 60% at 10% -10%, rgba(255, 107, 91, 0.22), transparent 60%),
          radial-gradient(ellipse 60% 55% at 95% 10%, rgba(88, 199, 243, 0.18), transparent 62%),
          #0b0e15;
        color: #edf1f8;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .left { flex: 1; }
      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
        margin-bottom: 36px;
      }
      .brand svg { width: 46px; height: 46px; filter: drop-shadow(0 0 16px rgba(255,107,91,0.45)); }
      .brand span {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 25px;
        letter-spacing: 0.01em;
      }
      h1 {
        font-size: 66px;
        line-height: 1.04;
        letter-spacing: -0.03em;
        margin-bottom: 26px;
      }
      p {
        font-size: 27px;
        line-height: 1.45;
        color: #a8b3c7;
        max-width: 18ch;
      }
      .url {
        margin-top: 40px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 22px;
        color: #58c7f3;
      }
      .qr {
        width: 340px;
        height: 340px;
        padding: 18px;
        background: #fff;
        border-radius: 20px;
        box-shadow: 0 0 60px rgba(88, 199, 243, 0.25);
        flex-shrink: 0;
      }
      .qr img { width: 100%; height: 100%; display: block; image-rendering: pixelated; }
    </style>
  </head>
  <body>
    <div class="left">
      <div class="brand">
        <svg viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg">
          <line x1="42.7" y1="49.96" x2="58.56" y2="34.94" stroke="#58C7F3" stroke-width="4" stroke-linecap="round" />
          <line x1="47.43" y1="63.58" x2="62.8" y2="64.98" stroke="#58C7F3" stroke-width="4" stroke-linecap="round" stroke-dasharray="0.1 8" />
          <line x1="69.85" y1="38.36" x2="72.41" y2="55.37" stroke="#58C7F3" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="0.1 6" opacity="0.65" />
          <circle cx="30" cy="62" r="15" fill="#FF6B5B" />
          <circle cx="68" cy="26" r="8" fill="none" stroke="#58C7F3" stroke-width="5" />
          <circle cx="74" cy="66" r="6.5" fill="none" stroke="#58C7F3" stroke-width="4.5" />
          <circle cx="17" cy="21" r="2.6" fill="#58C7F3" opacity="0.55" />
        </svg>
        <span>Le-Space</span>
      </div>
      <h1>libp2p WebRTC<br />over QR</h1>
      <p>No relay. No signaling server. Scan to connect.</p>
      <div class="url">webrtc-qr.le-space.de</div>
    </div>
    <div class="qr"><img src="${qr}" alt="" /></div>
  </body>
</html>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(html, { waitUntil: 'load' })
await page.screenshot({ path: OUT })
await browser.close()

console.log(`wrote ${OUT}`)

#!/usr/bin/env node
/**
 * Renders the installed-app icons from public/favicon.svg.
 *
 * Checked in rather than generated at build time, for the same reason as the
 * social card: an icon should change when someone decides it should, not when
 * a build runs. Re-run with:
 *
 *   pnpm --filter @le-space/libp2p-webrtc-qr-demo icons
 *
 * The maskable one is a different image, not the same image at a different
 * size. Android crops icons to whatever shape the launcher uses - circle,
 * squircle, teardrop - and only the centre 80% is guaranteed to survive. The
 * mark is drawn at 60% here so it clears that circle with room to spare, on a
 * background that bleeds to the edge so the crop never exposes a corner.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '../public')
const mark = readFileSync(resolve(publicDir, 'favicon.svg'), 'utf8')

// Matches --ls-bg-0. A transparent icon is what makes iOS render a home-screen
// tile with a black box behind it, so every one of these is painted.
const BACKGROUND = '#0b0e15'

const icons = [
  { file: 'icon-192.png', size: 192, scale: 1 },
  { file: 'icon-512.png', size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.6 },
  // 180 is what iOS asks for, and iOS ignores the manifest for this entirely.
  { file: 'apple-touch-icon.png', size: 180, scale: 0.82 }
]

const page = await (await chromium.launch()).newPage()

for (const { file, size, scale } of icons) {
  const inner = Math.round(size * scale)

  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<!DOCTYPE html>
    <style>
      html, body { margin: 0; width: ${size}px; height: ${size}px; }
      body {
        background: ${BACKGROUND};
        display: grid;
        place-items: center;
      }
      /* The mark's own rounded rect would show as a square inside the crop, so
         it is dropped here and the page provides the ground instead. */
      svg { width: ${inner}px; height: ${inner}px; }
      svg rect:first-of-type { display: none; }
    </style>
    ${mark}`)

  await page.screenshot({ path: resolve(publicDir, file), omitBackground: false })
  console.log(`${file}  ${size}x${size}`)
}

await page.context().browser().close()

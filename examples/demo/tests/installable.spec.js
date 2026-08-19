import { expect, test } from '@playwright/test'

/**
 * The demo as something you install, not a tab you keep finding again.
 *
 * Modelled on social-preview.spec.js, and for the same reason: a manifest and
 * its icons are declarations that keep working long after the file they point
 * at has been renamed. Every one of these asserts the asset actually ships.
 *
 * There is no service worker here on purpose. Chrome stopped requiring one for
 * installability in 108 on mobile and 112 on desktop, and caching a libp2p
 * stack is how you ship a version nobody can update.
 */

const manifestOf = async request => {
  const response = await request.get('/manifest.webmanifest')

  expect(response.status()).toBe(200)

  return response.json()
}

test.describe('installable', () => {
  test('the page links a manifest that is actually there', async ({ page, request }) => {
    await page.goto('/?view=technical')

    const href = await page.locator('link[rel="manifest"]').getAttribute('href')

    // Relative, because the same build is served from the custom domain and
    // from /ipfs/<cid>/ on any gateway. An absolute path would resolve to the
    // gateway's root, where this app is not.
    expect(href).toBe('./manifest.webmanifest')
    expect((await request.get('/manifest.webmanifest')).status()).toBe(200)
  })

  test('declares what an installed launch should look like', async ({ request }) => {
    const manifest = await manifestOf(request)

    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    // Matching --ls-bg-0, so the splash and the app are not two different dark
    // greys for the second it takes to paint.
    expect(manifest.background_color.toLowerCase()).toBe('#0b0e15')
    expect(manifest.theme_color.toLowerCase()).toBe('#0b0e15')
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.short_name.length).toBeGreaterThan(0)
  })

  test('every icon it names ships, at the size it claims', async ({ request }) => {
    const manifest = await manifestOf(request)

    // The failure this catches: the declaration survives a rename, the file
    // does not, and the install prompt silently stops appearing.
    for (const icon of manifest.icons) {
      const response = await request.get(icon.src.replace(/^\.\//, '/'))

      expect(response.status(), `${icon.src} must ship`).toBe(200)
      expect(response.headers()['content-type']).toContain('image/png')

      // PNG header: width and height are big-endian at bytes 16..24.
      const bytes = await response.body()
      const width = bytes.readUInt32BE(16)
      const height = bytes.readUInt32BE(20)

      expect(`${width}x${height}`, `${icon.src} is not ${icon.sizes}`).toBe(icon.sizes)
    }
  })

  test('carries the sizes and purposes an installer looks for', async ({ request }) => {
    const manifest = await manifestOf(request)
    const sizes = manifest.icons.map(icon => icon.sizes)

    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')

    // Without a maskable one, Android crops whatever it is given and the mark
    // loses its edges to whichever shape the launcher happens to use.
    expect(manifest.icons.some(icon => icon.purpose?.includes('maskable'))).toBe(true)
  })

  test('the iOS tags are present, because iOS reads none of the manifest', async ({ page, request }) => {
    await page.goto('/?view=technical')

    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', './apple-touch-icon.png')
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'WebRTC QR')

    const icon = await request.get('/apple-touch-icon.png')

    expect(icon.status()).toBe(200)
    expect((await icon.body()).readUInt32BE(16)).toBe(180)
  })

  test('an installed launch keeps its peer identity; a tab still does not', async ({ context }) => {
    // Playwright cannot emulate display-mode, so the query is answered the way
    // an installed launch answers it. That is the same signal the app reads.
    const asInstalled = page => page.addInitScript(() => {
      const real = window.matchMedia.bind(window)

      window.matchMedia = query => query.includes('display-mode: standalone')
        ? { matches: true, media: query, addEventListener () {}, removeEventListener () {} }
        : real(query)
    })

    const start = async page => {
      await page.goto('/?ice=host&view=technical')
      await page.locator('#start-client').click()
      await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

      return page.locator('#peer-id').textContent()
    }

    const first = await context.newPage()

    await asInstalled(first)
    const installedId = await start(first)

    // Session storage is what makes two tabs two peers. An installed app has no
    // second tab - it has the window you opened again - so the key has to live
    // somewhere that survives the launch, or every launch is a stranger.
    expect(await first.evaluate(() => localStorage.getItem('libp2p-webrtc-qr:identity:v1'))).not.toBeNull()
    expect(await first.evaluate(() => sessionStorage.getItem('libp2p-webrtc-qr:identity:v1'))).toBeNull()

    // A second page is a fresh sessionStorage and a shared localStorage, which
    // is exactly what relaunching an installed app looks like.
    const relaunched = await context.newPage()

    await asInstalled(relaunched)
    expect(await start(relaunched)).toBe(installedId)

    // And the tab behaviour it was built on is untouched: same browser, same
    // storage, different peer - because the two-tab handoff depends on it.
    const tab = await context.newPage()

    expect(await start(tab)).not.toBe(installedId)

    await first.close()
    await relaunched.close()
    await tab.close()
  })

  test('resetting clears both stores, not just the one in use', async ({ context }) => {
    const page = await context.newPage()

    await page.goto('/?ice=host&view=technical')
    await page.locator('#start-client').click()
    await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

    // Left behind in the other store, the same Peer ID would come straight back
    // the next time the app was launched the other way - which is the one thing
    // a reset must not do.
    await page.evaluate(() => localStorage.setItem('libp2p-webrtc-qr:identity:v1', 'stale'))
    await page.locator('details:has(#reset-identity) > summary').click()
    await page.locator('#reset-identity').click()

    expect(await page.evaluate(() => localStorage.getItem('libp2p-webrtc-qr:identity:v1'))).toBeNull()
    expect(await page.evaluate(() => sessionStorage.getItem('libp2p-webrtc-qr:identity:v1'))).toBeNull()

    await page.close()
  })

  test('ships no service worker, and that is the decision', async ({ page }) => {
    await page.goto('/?view=technical')

    // Asserted rather than left implicit, so nobody adds one by reflex. If one
    // is ever wanted, this test is the place the argument gets written down.
    expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull()
    expect(await page.locator('script[src*="sw"], link[rel="serviceworker"]').count()).toBe(0)
  })
})

test.describe('the peer id', () => {
  test('is readable whether the explanation is folded or not', async ({ page }) => {
    await page.goto('/?ice=host&view=technical')
    await page.locator('#start-client').click()
    await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

    // Folded is the default, and the one that used to hide it. A <details>
    // hides everything but its summary, and this is the line someone reads off
    // the screen to check against the other device.
    await expect(page.locator('details:has(#reset-identity)')).not.toHaveAttribute('open', '')
    await expect(page.locator('#peer-id')).toBeVisible()
    await expect(page.locator('#peer-id')).toHaveText(/^12D3KooW/)

    await page.locator('details:has(#reset-identity) > summary').click()
    await expect(page.locator('#peer-id')).toBeVisible()
  })

  test('says where the key is kept, and is right about it', async ({ context }) => {
    const tab = await context.newPage()

    await tab.goto('/?ice=host&view=technical')
    await tab.locator('#start-client').click()
    await tab.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

    await expect(tab.locator('#identity-origin')).toContainText('this tab')

    const installed = await context.newPage()

    await installed.addInitScript(() => {
      const real = window.matchMedia.bind(window)

      window.matchMedia = query => query.includes('display-mode: standalone')
        ? { matches: true, media: query, addEventListener () {}, removeEventListener () {} }
        : real(query)
    })
    await installed.goto('/?ice=host&view=technical')
    await installed.locator('#start-client').click()
    await installed.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

    // The line said "this tab" in both cases until the app became installable,
    // and was false in one of them afterwards.
    await expect(installed.locator('#identity-origin')).toContainText('this installed app')

    await tab.close()
    await installed.close()
  })
})

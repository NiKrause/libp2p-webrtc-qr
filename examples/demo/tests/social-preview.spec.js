import { test, expect } from '@playwright/test'

const CANONICAL = 'https://webrtc-qr.le-space.de/'

async function meta (page, selector) {
  return page.locator(selector).getAttribute('content')
}

test.describe('social preview and canonical', () => {
  test('declares a canonical url', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', CANONICAL)
  })

  test('image urls are absolute, because gateways resolve them from elsewhere', async ({ page }) => {
    await page.goto('/')

    // The build is served from the custom domain and from IPFS gateway paths
    // like /ipfs/<cid>/. A relative og:image resolves to a URL that does not
    // exist on the gateway, and the preview silently shows nothing.
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) {
      const value = await meta(page, selector)
      expect(value, `${selector} must be absolute`).toMatch(/^https:\/\//)
    }

    expect(await meta(page, 'meta[property="og:url"]')).toBe(CANONICAL)
  })

  test('the declared image actually ships in the build', async ({ page, request }) => {
    await page.goto('/')

    // The failure this catches: the tag survives a refactor, the asset does
    // not, and every shared link loses its preview without anything erroring.
    const declared = await meta(page, 'meta[property="og:image"]')
    const response = await request.get(new URL(declared).pathname)

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('image/png')
  })

  test('the declared image dimensions match the file', async ({ page, request }) => {
    await page.goto('/')

    const declared = await meta(page, 'meta[property="og:image"]')
    const buffer = await (await request.get(new URL(declared).pathname)).body()

    // PNG IHDR: width and height are big-endian uint32 at bytes 16 and 20.
    const width = buffer.readUInt32BE(16)
    const height = buffer.readUInt32BE(20)

    expect(width).toBe(Number(await meta(page, 'meta[property="og:image:width"]')))
    expect(height).toBe(Number(await meta(page, 'meta[property="og:image:height"]')))
    // Below 1200x630 the large-summary card is downgraded to a small thumbnail.
    expect(width).toBeGreaterThanOrEqual(1200)
    expect(height).toBeGreaterThanOrEqual(630)
  })

  test('titles and descriptions are present and not empty', async ({ page }) => {
    await page.goto('/')

    for (const selector of [
      'meta[name="description"]',
      'meta[property="og:title"]',
      'meta[property="og:description"]',
      'meta[property="og:image:alt"]',
      'meta[name="twitter:title"]',
      'meta[name="twitter:description"]'
    ]) {
      expect((await meta(page, selector))?.trim().length, selector).toBeGreaterThan(10)
    }

    expect(await meta(page, 'meta[name="twitter:card"]')).toBe('summary_large_image')
  })
})

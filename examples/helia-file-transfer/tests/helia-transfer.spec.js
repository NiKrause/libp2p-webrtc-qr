import { test, expect } from '@playwright/test'

const CONTENT = 'the bytes travelled over a QR-negotiated WebRTC connection'

async function openPeer (page, errors) {
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?ice=host')
  await page.waitForFunction(() => typeof window.__heliaQrTest?.createOffer === 'function')
  await page.evaluate(() => window.__heliaQrTest.start())
  await expect(page.locator('#peer-id')).not.toHaveText('not started')
}

test.describe('Helia over QR WebRTC', () => {
  test('transfers a file between two Helia nodes', async ({ browser }) => {
    const adder = await browser.newPage()
    const fetcher = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(adder, pageErrors)
      await openPeer(fetcher, pageErrors)

      // The whole handshake is two signed payloads - no relay, no signaling server.
      const offer = await adder.evaluate(() => window.__heliaQrTest.createOffer())
      expect(offer).toMatch(/^libp2p-webrtc-qr:1:|^\{/)

      const answer = await fetcher.evaluate(text => window.__heliaQrTest.acceptOffer(text), offer)
      await adder.evaluate(text => window.__heliaQrTest.acceptAnswer(text), answer)

      await expect.poll(() => adder.evaluate(() => window.__heliaQrTest.getConnections()), {
        timeout: 30000
      }).toBe(1)
      await expect.poll(() => fetcher.evaluate(() => window.__heliaQrTest.getConnections()), {
        timeout: 30000
      }).toBe(1)

      // Only the adder has the block. Bitswap has to pull it across.
      const cid = await adder.evaluate(text => window.__heliaQrTest.addFile(text), CONTENT)
      expect(cid).toMatch(/^bafk|^bafy|^Qm/)

      const fetched = await fetcher.evaluate(value => window.__heliaQrTest.fetchFile(value), cid)
      expect(fetched).toBe(CONTENT)

      expect(pageErrors).toEqual([])
    } finally {
      await adder.close()
      await fetcher.close()
    }
  })

  test('fetching an unknown CID fails rather than inventing content', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)

      // A well-formed CID nobody has. Without a peer holding it this must not resolve.
      const error = await page.evaluate(async () => {
        try {
          await window.__heliaQrTest.fetchFile('bafkreiaxnnnb7qz2focittuqq3ya25q7rcv3bqynnczfzako47346wofhu')
          return null
        } catch (err) {
          return err.message
        }
      })

      expect(error).not.toBeNull()
      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })
})

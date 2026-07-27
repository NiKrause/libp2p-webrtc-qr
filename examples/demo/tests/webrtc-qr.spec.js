import { test, expect } from '@playwright/test'

async function openPeer (page, errors) {
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?ice=host')
  await page.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
  await page.locator('#start-client').click()
  await expect(page.locator('#status')).toContainText('Browser client started')
}

async function sendAndExpect (sender, receiver, message) {
  await sender.evaluate(async value => {
    await window.__libp2pQrTest.sendMessage(value)
  }, message)

  await expect.poll(async () => {
    return receiver.evaluate(() => window.__libp2pQrTest.getLastReceivedMessage())
  }, { timeout: 20000 }).toBe(message)
}

test.describe('signed QR WebRTC signaling', () => {
  test('connects two browser libp2p peers and transfers data both ways', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      await offerer.locator('#create-offer').click()
      await expect(offerer.locator('#qr-image')).toBeVisible()
      const offerPayload = await offerer.locator('#payload-display').inputValue()
      expect(offerPayload).toMatch(/^libp2p-webrtc-qr:1:/)
      expect(offerPayload.length).toBeLessThan(2200)
      const offerQrDataUrl = await offerer.locator('#qr-image').getAttribute('src')
      const decodedOfferQr = await offerer.evaluate(dataUrl => {
        return window.__libp2pQrTest.decodeQrDataUrl(dataUrl)
      }, offerQrDataUrl)
      expect(decodedOfferQr).toBe(offerPayload)

      await answerer.locator('#payload-display').fill(offerPayload)
      await answerer.locator('#process-payload').click()
      await expect(answerer.locator('#status')).toContainText('Answer created')
      await expect(answerer.locator('#qr-image')).toBeVisible()
      const answerPayload = await answerer.locator('#payload-display').inputValue()
      expect(answerPayload).toMatch(/^libp2p-webrtc-qr:1:/)
      expect(answerPayload.length).toBeLessThan(2200)

      await offerer.locator('#payload-display').fill(answerPayload)
      await offerer.locator('#process-payload').click()
      await expect(offerer.locator('#status')).toContainText('Connected')

      await expect.poll(() => offerer.evaluate(() => window.__libp2pQrTest.getConnections()), {
        timeout: 20000
      }).toBe(1)
      await expect.poll(() => answerer.evaluate(() => window.__libp2pQrTest.getConnections()), {
        timeout: 20000
      }).toBe(1)

      await sendAndExpect(offerer, answerer, 'hello from offerer')
      await sendAndExpect(answerer, offerer, 'hello from answerer')

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('rejects a modified signed offer', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      const offerPayload = await offerer.evaluate(() => {
        return window.__libp2pQrTest.createOfferPayload()
      })
      const modifiedPayload = await offerer.evaluate(async offer => {
        const decoded = await window.__libp2pQrTest.decodePayload(offer)
        decoded.sdp = `${decoded.sdp}\na=x-tampered:1`
        return window.__libp2pQrTest.encodePayload(decoded)
      }, offerPayload)

      const errorMessage = await answerer.evaluate(async offer => {
        try {
          await window.__libp2pQrTest.acceptOfferPayload(offer)
          return null
        } catch (error) {
          return error.message
        }
      }, modifiedPayload)

      expect(errorMessage).toContain('signature is invalid')
      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('rejects a browser peer\'s own offer with a clear error', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)
      const offerPayload = await page.evaluate(() => {
        return window.__libp2pQrTest.createOfferPayload()
      })

      const errorMessage = await page.evaluate(async offer => {
        try {
          await window.__libp2pQrTest.acceptOfferPayload(offer)
          return null
        } catch (error) {
          return error.message
        }
      }, offerPayload)

      expect(errorMessage).toContain('offer belongs to this browser')
      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })
})

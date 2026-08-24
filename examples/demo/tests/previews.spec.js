import { expect, test } from '@playwright/test'

import { sniff } from '../previews.js'

/**
 * Pictures beside the names, and the keys between them.
 *
 * The transfer itself is covered by the bitswap test and takes ten seconds of
 * wantlist exchange to prove something this has no opinion about. What is
 * asserted here is what somebody *sees* once a file has arrived, so the bytes
 * are handed to the renderer directly.
 */

// A real 1×1 PNG and a real 1×1 GIF - decodable, so the browser renders them
// rather than showing two broken images that would pass these assertions just
// as well.
const PNG = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
]

const GIF = [
  0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xff, 0xff, 0xff, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b
]

const TEXT = [...'these are not pixels'].map(character => character.charCodeAt(0))

const render = (page, name, cid, bytes) =>
  page.evaluate(([name, cid, bytes]) => window.__libp2pQrTest.renderReceived(name, cid, bytes), [name, cid, bytes])

test.describe('what the bytes actually are', () => {
  test('is read from the file, never from what the sender called it', () => {
    // The announcement carries a MIME type and this ignores it. A peer controls
    // the bytes, the name and that field, and a blob URL made from it lives on
    // this origin - `text/html` there is somebody else's script with this
    // page's storage in reach.
    assert(sniff(new Uint8Array(PNG))?.type === 'image/png')
    assert(sniff(new Uint8Array(GIF))?.type === 'image/gif')
    assert(sniff(new Uint8Array(TEXT)) === null)

    // Including the one that would otherwise be the interesting attack: a file
    // whose bytes are markup gets no preview at all, whatever it claims to be.
    assert(sniff(new TextEncoder().encode('<svg onload="alert(1)">')) === null)

    function assert (condition) {
      expect(condition).toBe(true)
    }
  })
})

test.describe('previews of received files', () => {
  test('shows a thumbnail for a picture and nothing for a file it cannot read', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => typeof window.__libp2pQrTest?.renderReceived === 'function')

    await render(page, 'photo.png', 'bafyone', PNG)
    await render(page, 'notes.txt', 'bafytwo', TEXT)

    await expect(page.locator('.received-file')).toHaveCount(2)
    await expect(page.locator('.thumb')).toHaveCount(1)

    // The row without a picture keeps the shape it always had rather than
    // leaving a hole where a thumbnail would have been.
    await expect(page.locator('.received-file.has-preview')).toHaveCount(1)

    const image = page.locator('.thumb img')
    await expect(image).toHaveAttribute('src', /^blob:/)
    // Decoded, not merely present: a broken image would satisfy every
    // assertion above. Polled rather than read once, because decoding is
    // asynchronous however eagerly the load was started.
    await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBe(1)
  })

  test('opens the big version, and the arrow keys walk the pictures', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => typeof window.__libp2pQrTest?.renderReceived === 'function')

    await render(page, 'first.png', 'bafyone', PNG)
    // Between the two pictures on purpose: the keys have to step over it.
    await render(page, 'notes.txt', 'bafytwo', TEXT)
    await render(page, 'second.gif', 'bafythree', GIF)

    await page.locator('.thumb').first().click()
    await expect(page.locator('#preview')).toBeVisible()

    // The picture, not merely the dialog around it: an <img> that never decoded
    // satisfies every other assertion here while showing the person nothing.
    await expect.poll(() => page.locator('#preview-stage img').evaluate(node => node.naturalWidth)).toBe(1)

    await expect(page.locator('#preview-name')).toHaveText('first.png')
    await expect(page.locator('#preview-position')).toHaveText('1 of 2')

    // Right goes to the next *previewable* file, not the next file - stopping
    // on the text file would leave the dialog holding nothing.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('#preview-name')).toHaveText('second.gif')
    await expect(page.locator('#preview-position')).toHaveText('2 of 2')

    // And it wraps, because a gallery of two that stops at the second argues
    // with the person using it.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('#preview-name')).toHaveText('first.png')

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('#preview-name')).toHaveText('second.gif')

    // Escape is the dialog's own, and it must leave nothing playing behind it.
    await page.keyboard.press('Escape')
    await expect(page.locator('#preview')).toBeHidden()
    await expect(page.locator('#preview-stage')).toBeEmpty()
  })

  test('says nothing about position when there is nowhere to go', async ({ page }) => {
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => typeof window.__libp2pQrTest?.renderReceived === 'function')

    await render(page, 'only.png', 'bafyone', PNG)
    await page.locator('.thumb').click()

    // "1 of 1" is a control describing itself and doing nothing.
    await expect(page.locator('#preview-position')).toHaveText('')
  })

  test('a swipe moves as an arrow key does', async ({ page }) => {
    // Phones have no arrow keys, and the gallery is mostly met on a phone.
    // Pointer events rather than touch ones, so this drives the same code path
    // a thumb does.
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => typeof window.__libp2pQrTest?.renderReceived === 'function')

    await render(page, 'first.png', 'bafyone', PNG)
    await render(page, 'second.gif', 'bafytwo', GIF)

    await page.locator('.thumb').first().click()
    await expect(page.locator('#preview-name')).toHaveText('first.png')

    // The dialog, not the picture: that is what the swipe listens on, and with
    // a 1×1 test image the stage is a one-pixel strip nobody could aim at.
    const box = await page.locator('#preview').boundingBox()
    const y = box.y + box.height / 2

    // Dragged left brings the next one in from the right, which is what every
    // photo viewer has taught everybody to expect.
    await page.mouse.move(box.x + box.width * 0.8, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.1, y, { steps: 8 })
    await page.mouse.up()

    await expect(page.locator('#preview-name')).toHaveText('second.gif')

    await page.mouse.move(box.x + box.width * 0.1, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 8 })
    await page.mouse.up()

    await expect(page.locator('#preview-name')).toHaveText('first.png')
  })

  test('a small drag is not a swipe', async ({ page }) => {
    // Somebody who moved a finger while looking is not asking for the next
    // picture, and a gallery that skips ahead on that is one nobody trusts.
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => typeof window.__libp2pQrTest?.renderReceived === 'function')

    await render(page, 'first.png', 'bafyone', PNG)
    await render(page, 'second.gif', 'bafytwo', GIF)

    await page.locator('.thumb').first().click()

    const box = await page.locator('#preview').boundingBox()
    const y = box.y + box.height / 2

    await page.mouse.move(box.x + box.width * 0.5, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.44, y, { steps: 4 })
    await page.mouse.up()

    await expect(page.locator('#preview-name')).toHaveText('first.png')
  })

  test('the sender keeps a copy of what they sent', async ({ page }) => {
    // Reported: Bob receives the picture correctly and Alice never sees it
    // again. A file that vanishes the moment it is sent leaves the person who
    // sent it with no record of what went - and, now that there are previews,
    // no way back to it either.
    await page.goto('/?ice=host&view=technical&intro=off')
    await page.waitForFunction(() => typeof window.__libp2pQrTest?.renderReceived === 'function')

    await page.evaluate(bytes => window.__libp2pQrTest.renderReceived('mine.png', 'bafymine', bytes, 'sent'), PNG)
    await render(page, 'theirs.gif', 'bafytheirs', GIF)

    await expect(page.locator('.received-file.is-sent')).toHaveCount(1)
    await expect(page.locator('.received-file.is-received')).toHaveCount(1)

    // Both are previewable, so the gallery walks the whole conversation rather
    // than half of it.
    await expect(page.locator('.thumb')).toHaveCount(2)
    await page.locator('.thumb').first().click()
    await expect(page.locator('#preview-position')).toHaveText('1 of 2')
  })
})


import { test, expect } from '@playwright/test'

/**
 * Playwright's WebKit build for Linux has no working WebRTC, so anything that
 * needs a connection to come up cannot be verified there - it passes on the
 * macOS build, which is closer to real Safari. Everything that does not need a
 * peer connection still runs on WebKit everywhere, which is most of the suite.
 */
function skipWithoutWebRTC (test, browserName) {
  test.skip(
    browserName === 'webkit' && process.platform === 'linux',
    'Playwright WebKit on Linux cannot establish a WebRTC connection'
  )
}

async function openPeer (page, errors) {
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?ice=host')
  await page.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
  await page.locator('#start-client').click()
  await expect(page.locator('#status')).toContainText('Browser client started')
}

async function createInvite (page) {
  // Once connected the setup card is folded, so the button inside it is not
  // clickable - which is exactly why "invite someone else" exists.
  if (await page.locator('#step-connect.is-collapsed').count() > 0) {
    await page.locator('#invite-another').click()
  } else {
    await page.locator('#create-offer').click()
  }

  // Gathering ICE against real STUN servers is seconds of work, and a loaded CI
  // runner stretches it further - the default five seconds is a bet on the
  // machine being idle, not an assertion about the app.
  await expect(page.locator('#invite-box')).toBeVisible({ timeout: 30000 })
  // The box is emptied while the next invite is gathering, so waiting for any
  // `#i=` would otherwise hand back the previous person's link.
  await expect.poll(() => page.locator('#invite-link').inputValue()).toMatch(/#i=/)

  return page.locator('#invite-link').inputValue()
}

async function useLink (page, link) {
  // While an invite is on screen the page behind it is inert, which is the
  // whole point of a modal - so the way to the paste field is the button inside
  // it, exactly as a person would find it.
  if (await page.locator('#invite-box[open]').count() > 0) {
    await page.locator('#paste-reply').click()
  } else {
    // Otherwise it is the fallback for a link that did not open the page by
    // itself, and sits behind a disclosure rather than in everyone's way.
    await page.locator('.paste-fallback').evaluate(details => { details.open = true })
  }

  await page.locator('#payload-display').fill(link)
  await page.locator('#process-payload').click()
}

async function replyLinkOf (page) {
  await expect(page.locator('#invite-box')).toBeVisible()
  await expect.poll(() => page.locator('#invite-link').inputValue()).toMatch(/#r=/)

  return page.locator('#invite-link').inputValue()
}

async function connectPeers (offerer, answerer) {
  const invite = await createInvite(offerer)

  await useLink(answerer, invite)
  const reply = await replyLinkOf(answerer)

  await useLink(offerer, reply)
  await expect(offerer.locator('#status')).toContainText('Connected')

  // Not `toBe(1)`: a peer that already has connections gains one more, and
  // pinning the count to one is what made this helper two-peer-only.
  for (const page of [offerer, answerer]) {
    await expect.poll(() => page.evaluate(() => window.__libp2pQrTest.getConnections()), {
      timeout: 20000
    }).toBeGreaterThanOrEqual(1)
  }
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
  test('connects two browser libp2p peers and transfers data both ways', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)
      await connectPeers(offerer, answerer)

      await sendAndExpect(offerer, answerer, 'hello from offerer')
      await sendAndExpect(answerer, offerer, 'hello from answerer')

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('folds the setup steps away once connected, and back if it drops', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      for (const id of ['#step-start', '#step-connect']) {
        await expect(offerer.locator(id)).not.toHaveClass(/is-collapsed/)
      }

      await connectPeers(offerer, answerer)

      // Setup is finished business once a connection exists, and on a phone it
      // pushes the only useful part below the fold.
      for (const page of [offerer, answerer]) {
        for (const id of ['#step-start', '#step-connect']) {
          await expect(page.locator(id)).toHaveClass(/is-collapsed/)
        }
        await expect(page.locator('#step-data')).not.toHaveClass(/is-collapsed/)
      }

      // Folded away, not gone: the heading stays and brings the step back.
      await offerer.locator('#step-connect .step-heading').click()
      await expect(offerer.locator('#step-connect')).not.toHaveClass(/is-collapsed/)
      await expect(offerer.locator('#step-connect .step-heading')).toHaveAttribute('aria-expanded', 'true')

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('sends a message when Enter is pressed', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)
      await connectPeers(offerer, answerer)

      // Enter is what everyone tries first next to a single-line field.
      await offerer.locator('#message').fill('sent with the keyboard')
      await offerer.locator('#message').press('Enter')

      await expect.poll(async () => {
        return answerer.evaluate(() => window.__libp2pQrTest.getLastReceivedMessage())
      }, { timeout: 20000 }).toBe('sent with the keyboard')

      // ...and the field is cleared, so the next message does not append.
      await expect(offerer.locator('#message')).toHaveValue('')

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('holds three peers at once and labels who said what', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const hub = await browser.newPage()
    const bob = await browser.newPage()
    const carol = await browser.newPage()
    const pageErrors = []

    try {
      for (const page of [hub, bob, carol]) {
        await openPeer(page, pageErrors)
      }

      // Creating a second invite used to close the first connection outright.
      await connectPeers(hub, bob)
      await connectPeers(hub, carol)

      await expect.poll(() => hub.evaluate(() => window.__libp2pQrTest.getPeers().length), {
        timeout: 20000
      }).toBe(2)
      await expect(hub.locator('qr-peers .row')).toHaveCount(2)
      await expect(hub.locator('#peer-count')).toContainText('2 connected')

      // One conversation: what the hub types reaches both.
      await hub.evaluate(() => window.__libp2pQrTest.sendMessage('hello both of you'))

      for (const page of [bob, carol]) {
        await expect.poll(() => page.evaluate(() => window.__libp2pQrTest.getLastReceivedMessage()), {
          timeout: 20000
        }).toBe('hello both of you')
      }

      // ...and an incoming line says who sent it, which is the whole point
      // once there are more than two people.
      const hubPeerId = await hub.locator('#peer-id').textContent()
      const received = await bob.evaluate(() => window.__libp2pQrTest.getReceivedWithSenders())
      expect(received.at(-1).from).toBe(hubPeerId.trim())

      expect(pageErrors).toEqual([])
    } finally {
      await hub.close()
      await bob.close()
      await carol.close()
    }
  })

  test('says when a connection is lost instead of going quiet', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)
    // WebRTC takes about half a minute of failed consent checks before it calls
    // a connection dead, and that timing is not engine-specific.

    const alice = await browser.newPage()
    const bob = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(alice, pageErrors)
      await openPeer(bob, pageErrors)
      await connectPeers(alice, bob)

      await expect(alice.locator('qr-peers .health')).toContainText('connected')

      // A phone whose radio slept, or whose peer went away, comes back to a
      // page that used to look perfectly fine and say nothing.
      // A phone whose radio slept, or a tab the OS discarded: the connection
      // ends underneath a page that otherwise keeps looking perfectly fine.
      const peerId = await alice.evaluate(() => window.__libp2pQrTest.getPeers()[0])
      await alice.evaluate(id => window.__libp2pQrTest.simulateConnectionLoss(id), peerId)

      // It says so, and it says what to do about it. With only two peers there
      // is no third party to signal through, so the way back is a human one -
      // which the page now offers rather than describes.
      await expect(alice.locator('#status')).toContainText('Lost the connection')
      await expect(alice.locator('#status')).toContainText('reconnect below')
      await expect(alice.locator('#reconnect')).toBeVisible()

      expect(pageErrors).toEqual([])
    } finally {
      await alice.close()
    }
  })

  test('a third peer closes the mesh without anyone scanning again', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)
    test.setTimeout(120000)

    const hub = await browser.newPage()
    const bob = await browser.newPage()
    const carol = await browser.newPage()
    const pageErrors = []

    try {
      for (const page of [hub, bob, carol]) {
        await openPeer(page, pageErrors)
      }

      // Only the hub's two links are ever exchanged by a human.
      await connectPeers(hub, bob)
      await connectPeers(hub, carol)

      const bobId = await bob.locator('#peer-id').textContent()
      const carolId = await carol.locator('#peer-id').textContent()

      // Bob and Carol have never seen each other's code. They learn of one
      // another over their connections to the hub, exchange signed payloads
      // through it, and end up connected directly.
      await expect.poll(() => bob.evaluate(() => window.__libp2pQrTest.getPeers().length), {
        timeout: 60000
      }).toBe(2)
      await expect.poll(() => carol.evaluate(() => window.__libp2pQrTest.getPeers().length), {
        timeout: 60000
      }).toBe(2)

      expect(await bob.evaluate(() => window.__libp2pQrTest.getPeers())).toContain(carolId.trim())
      expect(await carol.evaluate(() => window.__libp2pQrTest.getPeers())).toContain(bobId.trim())

      // ...and it is a real connection, not just an entry in a list.
      await carol.evaluate(() => window.__libp2pQrTest.sendMessage('straight to you, Bob'))
      await expect.poll(() => bob.evaluate(() => {
        return window.__libp2pQrTest.getReceivedWithSenders().at(-1)
      }), { timeout: 30000 }).toMatchObject({ from: carolId.trim(), text: 'straight to you, Bob' })

      expect(pageErrors).toEqual([])
    } finally {
      await hub.close()
      await bob.close()
      await carol.close()
    }
  })

  test('says what the network will allow before anyone tries to connect', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.goto('/')
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
      await page.locator('#start-client').click()

      const state = page.locator('qr-status')
      await expect(state).toBeVisible({ timeout: 30000 })
      // The host keeps the summary verdict as a class, so one element still
      // says how it went; the wording lives inside the shadow root.
      await expect(state).toHaveClass(/is-(open|symmetric|blocked|relay)/)

      // One LED per address family, plus the summary. Each has to reach a real
      // verdict - an unlit dot means the probe never finished.
      // Five rows now: browser and camera either side of the two families, with
      // the summary last.
      for (const id of [1, 2, 3, 4, 5].map(row => `.line:nth-child(${row})`)) {
        const line = page.locator(`qr-status ${id}`)

        await expect(line).toHaveClass(/(open|symmetric|blocked|relay)/)
        expect((await line.locator('.tip').textContent()).length).toBeGreaterThan(20)

        // Colour alone does not carry a verdict to anyone who cannot see it.
        expect((await line.locator('.verdict').textContent()).length).toBeGreaterThan(0)
      }

      // Deliberately not disabled: a symmetric NAT still connects peers on the
      // same network, which is the case this project is mostly used for.
      // Hiding the controls would block something that works.
      await expect(page.locator('#create-offer')).toBeEnabled()

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('the explanations open on tap, not only on hover', async ({ browser }) => {
    // A phone has no hover, so a tooltip that only reveals on hover is a
    // tooltip that a phone user can never read.
    const context = await browser.newContext({
      viewport: { width: 390, height: 800 },
      hasTouch: true
    })
    const page = await context.newPage()

    try {
      await page.goto('/')
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
      await page.locator('#start-client').click()
      await expect(page.locator('qr-status')).toBeVisible({ timeout: 30000 })

      // browser, IPv4, IPv6, camera, summary - so the two families are the
      // second and third chips rather than the first and second.
      const chip = row => page.locator(`qr-status .line:nth-child(${row}) button`)
      const tip = row => page.locator(`qr-status .line:nth-child(${row}) .tip`)

      await expect(tip(2)).toBeHidden()

      await chip(2).tap()
      await expect(tip(2)).toBeVisible()

      // Opening one closes the other, so two boxes never overlap.
      await chip(3).tap()
      await expect(tip(3)).toBeVisible()
      await expect(tip(2)).toBeHidden()

      // Tapping the open chip again closes it.
      await chip(3).tap()
      await expect(tip(3)).toBeHidden()

      // ...and tapping anywhere else does too.
      await chip(5).tap()
      await expect(tip(5)).toBeVisible()
      await page.locator('#status').tap()
      await expect(tip(5)).toBeHidden()

      // Five chips in a row must not push the page sideways on a phone.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    } finally {
      await context.close()
    }
  })

  test('says who sees the address before the check runs, not after', async ({ browser }) => {
    const page = await browser.newPage()

    try {
      await page.goto('/')

      // Before any click: the disclosure has to be readable while the choice to
      // click is still open, and it has to name the operators that get the
      // address rather than saying "a STUN server" and leaving it there.
      const disclosure = page.locator('#stun-disclosure')
      await expect(disclosure).toBeVisible()

      const text = await disclosure.textContent()

      expect(text).toContain('Cloudflare')
      expect(text).toContain('Google')
      expect(text).toMatch(/IPv6/)

      // It sits above the button it describes.
      const summary = await disclosure.locator('summary').boundingBox()
      const button = await page.locator('#start-client').boundingBox()

      expect(summary.y).toBeLessThan(button.y)
    } finally {
      await page.close()
    }
  })

  test('a lost connection comes back through the mesh, with no scanning', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)
    test.setTimeout(140000)

    const hub = await browser.newPage()
    const bob = await browser.newPage()
    const carol = await browser.newPage()
    const pageErrors = []

    try {
      for (const page of [hub, bob, carol]) {
        await openPeer(page, pageErrors)
      }

      await connectPeers(hub, bob)
      await connectPeers(hub, carol)

      const bobId = (await bob.locator('#peer-id').textContent()).trim()
      const carolId = (await carol.locator('#peer-id').textContent()).trim()

      for (const page of [bob, carol]) {
        await expect.poll(() => page.evaluate(() => window.__libp2pQrTest.getPeers().length), {
          timeout: 60000
        }).toBe(2)
      }

      // Drop the Bob-Carol link on both sides, the way a phone going into
      // standby drops it: the hub is untouched and still reaches both.
      await bob.evaluate(id => window.__libp2pQrTest.simulateConnectionLoss(id), carolId)
      await carol.evaluate(id => window.__libp2pQrTest.simulateConnectionLoss(id), bobId)

      await expect.poll(() => bob.evaluate(() => window.__libp2pQrTest.getPeers().length), {
        timeout: 20000
      }).toBe(1)

      // Nobody scans anything. The peer that kept a route home renegotiates
      // through it, and the link is simply back.
      await expect.poll(() => bob.evaluate(() => window.__libp2pQrTest.getPeers().length), {
        timeout: 90000
      }).toBe(2)
      await expect.poll(() => carol.evaluate(() => window.__libp2pQrTest.getPeers().length), {
        timeout: 90000
      }).toBe(2)

      expect(await bob.evaluate(() => window.__libp2pQrTest.getPeers())).toContain(carolId)
      expect(await carol.evaluate(() => window.__libp2pQrTest.getPeers())).toContain(bobId)

      // And it carries traffic, rather than merely appearing in a list again.
      await carol.evaluate(() => window.__libp2pQrTest.sendMessage('back again'))
      await expect.poll(() => bob.evaluate(() => window.__libp2pQrTest.getReceivedMessages()), {
        timeout: 30000
      }).toContain('back again')

      // Reconnecting on its own means the human prompt must stay out of the way.
      await expect(bob.locator('#reconnect-prompt')).toBeHidden()

      expect(pageErrors).toEqual([])
    } finally {
      await hub.close()
      await bob.close()
      await carol.close()
    }
  })

  test('offers a one-tap reconnect when no route home is left', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const alice = await browser.newPage()
    const bob = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(alice, pageErrors)
      await openPeer(bob, pageErrors)
      await connectPeers(alice, bob)

      await expect(alice.locator('#reconnect-prompt')).toBeHidden()

      // Two peers and one connection: when it goes, there is no third party to
      // signal through and no amount of cleverness invents one.
      const peerId = await alice.evaluate(() => window.__libp2pQrTest.getPeers()[0])
      await alice.evaluate(id => window.__libp2pQrTest.simulateConnectionLoss(id), peerId)

      const prompt = alice.locator('#reconnect-prompt')
      await expect(prompt).toBeVisible({ timeout: 20000 })
      await expect(prompt).toContainText('no one else can reach them')

      // One tap, not a walk back through the setup.
      await alice.locator('#reconnect').click()
      await expect(alice.locator('#invite-box')).toBeVisible({ timeout: 30000 })
      await expect.poll(() => alice.locator('#invite-link').inputValue()).toMatch(/#i=/)
      await expect(prompt).toBeHidden()

      expect(pageErrors).toEqual([])
    } finally {
      await alice.close()
      await bob.close()
    }
  })

  test('scanning opens a camera modal that releases the camera on every way out', async ({ browser, browserName }) => {
    // WebKit has no synthetic camera to give, so there is no track to release.
    test.skip(browserName === 'webkit', 'no fake camera device available')

    const page = await browser.newPage()
    const pageErrors = []

    try {
      // Watch what the browser actually handed out, rather than whether the
      // dialog closed. A modal can close over a track that is still live, and
      // that is the failure users report as spyware: the camera light stays on
      // with nothing on screen to explain it.
      await page.addInitScript(() => {
        window.__cameraTracks = []
        const media = navigator.mediaDevices

        if (media?.getUserMedia) {
          const original = media.getUserMedia.bind(media)

          media.getUserMedia = async constraints => {
            const stream = await original(constraints)
            window.__cameraTracks.push(...stream.getTracks())
            return stream
          }
        }
      })

      await openPeer(page, pageErrors)

      const modal = page.locator('qr-scanner dialog')
      const cameraLive = () =>
        page.evaluate(() => window.__cameraTracks.some(track => track.readyState === 'live'))

      await expect(modal).toBeHidden()
      await page.locator('#scan-offer').click()

      // The camera the user just asked for is in front of them, not below the
      // fold of a long page.
      await expect(modal).toBeVisible()
      await expect(page.locator('qr-scanner video')).toBeVisible()
      await expect(page.locator('qr-scanner h3')).toHaveText('Scan their code')
      await expect.poll(() => page.evaluate(() => window.__libp2pQrTest.scannerOpen()), {
        timeout: 20000
      }).toBe(true)
      await expect.poll(cameraLive, { timeout: 20000 }).toBe(true)

      // Escape is a close path the app never sees, so it is the one most likely
      // to leak a camera track.
      await page.keyboard.press('Escape')
      await expect(modal).toBeHidden()
      await expect.poll(() => page.evaluate(() => window.__libp2pQrTest.scannerOpen())).toBe(false)
      await expect.poll(cameraLive).toBe(false)

      // Focus goes back where it came from, which `showModal()` handles - the
      // assertion is here so replacing it with a hand-rolled modal cannot
      // quietly drop it.
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('scan-offer')

      // ...and the × does the same.
      await page.locator('#scan-offer').click()
      await expect(modal).toBeVisible()
      await page.locator('qr-scanner button').click()
      await expect(modal).toBeHidden()
      await expect.poll(() => page.evaluate(() => window.__libp2pQrTest.scannerOpen())).toBe(false)
      await expect.poll(cameraLive).toBe(false)

      // The path with no close at all: a framework unmounts the element while
      // the camera is running, so only disconnectedCallback can release it.
      //
      // Asserting on the track would prove nothing here. Chromium ends a fake
      // device's track when the <video> consuming it leaves the document, so
      // that assertion passes just as well with the release deleted - checked
      // by deleting it. What only the release produces is a detached element
      // holding no stream, so that is what this asserts.
      await page.locator('#scan-offer').click()
      await expect(modal).toBeVisible()
      await expect.poll(cameraLive, { timeout: 20000 }).toBe(true)

      const releasedOnDetach = await page.evaluate(() => {
        const scanner = document.querySelector('qr-scanner')

        scanner.remove()

        return scanner.shadowRoot.querySelector('video').srcObject == null
      })

      expect(releasedOnDetach).toBe(true)
      await expect.poll(cameraLive).toBe(false)

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('the invite is a modal that closes itself once the answer lands', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      const invite = offerer.locator('#invite-box')

      await expect(invite).toBeHidden()
      await createInvite(offerer)
      await expect(invite).toBeVisible()

      // Waiting for a reply is what this modal is for, so both ways of getting
      // one are inside it rather than behind it.
      await expect(offerer.locator('#scan-reply')).toBeVisible()
      await expect(offerer.locator('#paste-reply')).toBeVisible()

      await useLink(answerer, await offerer.locator('#invite-link').inputValue())
      const reply = await replyLinkOf(answerer)

      await useLink(offerer, reply)
      await expect(offerer.locator('#status')).toContainText('Connected')

      // Nothing left to show: the code was only ever a means to this.
      await expect(invite).toBeHidden()
      await expect(answerer.locator('#invite-box')).toBeHidden()

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('the peer id survives a reload, and resetting it changes it', async ({ browser }) => {
    // An explicit context so a second tab can be opened beside the first, which
    // is what "two tabs of the same browser" actually means.
    const context = await browser.newContext()
    const page = await context.newPage()
    const pageErrors = []

    const start = async () => {
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
      await page.locator('#start-client').click()
      await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

      return page.locator('#peer-id').textContent()
    }

    try {
      page.on('pageerror', error => pageErrors.push(error.message))
      await page.goto('/?ice=host')

      const first = await start()

      expect(await page.locator('#identity-origin').textContent()).toContain('Freshly generated')

      await page.reload()

      // The point of persisting: a phone whose tab was discarded while it slept
      // comes back as the same peer rather than as a stranger nobody can place.
      expect(await start()).toBe(first)
      expect(await page.locator('#identity-origin').textContent()).toContain('Restored')

      // Scoped to the tab, not the browser. Sharing one identity across tabs
      // would make a peer refuse to dial itself, and the two-tab handoff this
      // demo depends on would break with an error about connecting to yourself.
      const otherTab = await context.newPage()

      try {
        await otherTab.goto('/?ice=host')
        await otherTab.waitForFunction(() => typeof window.__libp2pQrTest?.createOfferPayload === 'function')
        await otherTab.locator('#start-client').click()
        await otherTab.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')

        expect(await otherTab.locator('#peer-id').textContent()).not.toBe(first)
      } finally {
        await otherTab.close()
      }

      // A stored identifier that cannot be cleared is not a choice, so the reset
      // has to actually produce a different peer.
      await page.locator('details:has(#reset-identity) > summary').click()
      await page.locator('#reset-identity').click()

      expect(await start()).not.toBe(first)
      expect(pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('holds a screen wake lock only while a connection is live', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      // Nothing to protect yet - a lock held on an idle page is a phone kept
      // awake for no reason.
      expect(await offerer.evaluate(() => window.__libp2pQrTest.wakeLockState().wanted)).toBe(false)

      await connectPeers(offerer, answerer)

      // `wanted` is our decision and `held` is the browser's answer to it. Only
      // the first is asserted: a headless browser exposes the API and then
      // refuses every request, having no screen to keep awake, so asserting on
      // `held` would be asserting on the platform rather than on this code.
      await expect.poll(async () => {
        return offerer.evaluate(() => window.__libp2pQrTest.wakeLockState().wanted)
      }, { timeout: 10000 }).toBe(true)

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('an oversized payload survives the multi-frame round trip', async ({ browser }) => {
    const page = await browser.newPage()

    try {
      await page.goto('/')
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.bcurFrames === 'function')

      const result = await page.evaluate(async () => {
        // Deliberately larger than anything real ICE produces, so the split is
        // exercised rather than skipped.
        const payload = 'https://webrtc-qr.le-space.de/#i=' + 'x'.repeat(3000)
        const { total, frames, extra } = await window.__libp2pQrTest.bcurFrames(payload)

        return {
          payload,
          total,
          frames,
          extra,
          longest: Math.max(...frames.map(f => f.length)),
          // Every part in order.
          inOrder: await window.__libp2pQrTest.bcurReceive(frames),
          // A scanner that missed the first two frames and joined late: the
          // remaining pure parts plus fountain frames have to be enough.
          joinedLate: await window.__libp2pQrTest.bcurReceive([...frames.slice(2), ...extra, ...frames.slice(0, 2)])
        }
      })

      expect(result.total).toBeGreaterThan(1)

      // Uppercase keeps the code in QR alphanumeric mode, which is what makes
      // splitting worth doing - lowercase would need a visibly denser code.
      for (const frame of result.frames) {
        expect(frame).toBe(frame.toUpperCase())
        expect(frame.startsWith('UR:')).toBe(true)
      }

      // Each frame has to be small enough to stay scannable on a narrow phone.
      expect(result.longest).toBeLessThan(600)

      const completed = result.inOrder.filter(step => step.state === 'complete')

      expect(completed).toHaveLength(1)
      expect(completed[0].payload).toBe(result.payload)

      // No part before the last one may claim completion.
      expect(result.inOrder.slice(0, -1).every(step => step.state === 'progress')).toBe(true)

      // Progress has to be reported, not just the final answer.
      expect(result.inOrder[0].total).toBe(result.total)
      expect(result.inOrder[0].received).toBe(1)

      const lateCompleted = result.joinedLate.filter(step => step.state === 'complete')

      expect(lateCompleted).toHaveLength(1)
      expect(lateCompleted[0].payload).toBe(result.payload)
    } finally {
      await page.close()
    }
  })

  test('the animated code on screen decodes back into the invite link', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)
      // A compact payload fits one static code, which is the point of it - so
      // this test asks for the long format explicitly rather than hoping the
      // payload is big. Turning the box off is also the only way a person meets
      // an older peer, so the path is worth keeping exercised either way.
      await page.locator('#compact-payload').uncheck()
      await page.locator('#create-offer').click()
      await page.locator('qr-invite img').waitFor({ state: 'visible', timeout: 30000 })

      const link = await page.locator('#invite-link').inputValue()

      // The whole point of the split, so the test is worthless if the payload
      // happened to be small enough for one code.
      expect(link.length).toBeGreaterThan(600)
      await expect(page.locator('qr-invite p')).toBeVisible()
      await expect(page.locator('qr-invite p')).toContainText(/Part \d+ of \d+/)

      // Read what is actually on screen, frame by frame, exactly as a camera
      // would - then hand those strings to the accumulator.
      const reassembled = await page.evaluate(async () => {
        const seen = []
        // The code is inside the element's shadow root now.
        const image = document.getElementById('qr-image').shadowRoot.querySelector('img')

        for (let i = 0; i < 40; i++) {
          const decoded = await window.__libp2pQrTest.decodeQrDataUrl(image.src)

          if (decoded != null) {
            seen.push(decoded)
          }

          await new Promise(resolve => setTimeout(resolve, 120))
        }

        const steps = await window.__libp2pQrTest.bcurReceive(seen)
        const done = steps.find(step => step.state === 'complete')

        return { frames: seen.length, distinct: new Set(seen).size, payload: done?.payload ?? null }
      })

      // If the animation had stalled, every sample would be the same frame.
      expect(reassembled.distinct).toBeGreaterThan(1)
      expect(reassembled.payload).toBe(link)
      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('a short invite stays a single code, a long one animates', async ({ browser }) => {
    const page = await browser.newPage()

    try {
      await page.goto('/')
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.needsAnimation === 'function')

      const verdicts = await page.evaluate(() => {
        const check = window.__libp2pQrTest.needsAnimation
        const isPart = window.__libp2pQrTest.looksLikeUrPart

        return {
          short: check('https://webrtc-qr.le-space.de/#i=' + 'x'.repeat(300)),
          long: check('https://webrtc-qr.le-space.de/#i=' + 'x'.repeat(1200)),
          partUpper: isPart('UR:BYTES/1-6/LPADAACF'),
          partLower: isPart('ur:bytes/1-6/lpadaacf'),
          plainLink: isPart('https://webrtc-qr.le-space.de/#i=abc')
        }
      })

      expect(verdicts).toEqual({
        short: false,
        long: true,
        // Case-insensitive, because the code carries uppercase and the library
        // wants lowercase.
        partUpper: true,
        partLower: true,
        plainLink: false
      })
    } finally {
      await page.close()
    }
  })

  test('the invite is a link, and the QR encodes that link', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)
      const invite = await createInvite(page)

      // A link, not a wall of base64 - that difference is the whole point.
      expect(invite).toMatch(/^https?:\/\/[^#]+#i=/)
      expect(invite.length).toBeLessThan(2200)

      // The QR carries the link, so a phone's own camera app opens the page with
      // the payload already loaded instead of needing the in-app scanner. A link
      // too dense for one code is split into frames, and then it is the sequence
      // that carries it - so read whichever is on screen and reassemble.
      await expect(page.locator('qr-invite img')).toBeVisible()
      // Polled, not read once: decoding a dense code off a canvas occasionally
      // sees a frame that has not finished painting and yields null. Retrying
      // does not weaken the assertion - a QR with the wrong contents still
      // never matches.
      await expect.poll(async () => {
        return page.evaluate(async () => {
          // The code is inside the element's shadow root now.
        const image = document.getElementById('qr-image').shadowRoot.querySelector('img')
          const first = await window.__libp2pQrTest.decodeQrDataUrl(image.src)

          if (first == null) {
            return null
          }

          if (!window.__libp2pQrTest.looksLikeUrPart(first)) {
            return first
          }

          const seen = []

          for (let i = 0; i < 30; i++) {
            const frame = await window.__libp2pQrTest.decodeQrDataUrl(image.src)

            if (frame != null) {
              seen.push(frame)
            }

            await new Promise(resolve => setTimeout(resolve, 120))
          }

          const steps = await window.__libp2pQrTest.bcurReceive(seen)

          return steps.find(step => step.state === 'complete')?.payload ?? null
        })
      }, { timeout: 40000 }).toBe(invite)

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('accepts a scanned QR now that it carries a link', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)
      const invite = await createInvite(page)

      // The camera cannot be driven by a test, so this drives the step the
      // camera feeds. When the QR started carrying a link instead of a raw
      // payload, this check rejected every scan as "not a libp2p offer" - found
      // by hand, because nothing here was covered.
      const scannedLink = await page.evaluate(async text => {
        return window.__libp2pQrTest.classifyScanned(text, 'offer')
      }, invite)
      expect(scannedLink.ok, scannedLink.reason).toBe(true)

      // A bare payload - what an older code or an older build produces - must
      // still work.
      const bare = decodeURIComponent(new URL(invite).hash.replace('#i=', ''))
      const scannedBare = await page.evaluate(async text => {
        return window.__libp2pQrTest.classifyScanned(text, 'offer')
      }, bare)
      expect(scannedBare.ok, scannedBare.reason).toBe(true)

      // The wrong kind is still named as such rather than accepted.
      const wrongType = await page.evaluate(async text => {
        return window.__libp2pQrTest.classifyScanned(text, 'answer')
      }, invite)
      expect(wrongType.ok).toBe(false)
      expect(wrongType.reason).toContain('waiting for an answer')

      const junk = await page.evaluate(() => {
        return window.__libp2pQrTest.classifyScanned('https://example.com/', 'offer')
      })
      expect(junk.ok).toBe(false)

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('survives being backgrounded while the reply is carried to a messenger', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const alice = await browser.newPage()
    const bob = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(alice, pageErrors)
      await openPeer(bob, pageErrors)

      const invite = await createInvite(alice)
      await useLink(bob, invite)
      const reply = await replyLinkOf(bob)

      // Bob now switches to a messenger to send that link. Mobile browsers fire
      // these while backgrounding a page, and a teardown here closed his peer
      // connection at exactly the moment the whole flow depends on it.
      await bob.evaluate(() => {
        window.dispatchEvent(new Event('beforeunload'))
        window.dispatchEvent(new Event('pagehide'))
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await bob.waitForTimeout(500)

      await useLink(alice, reply)
      await expect(alice.locator('#status')).toContainText('Connected')
      await expect.poll(() => bob.evaluate(() => window.__libp2pQrTest.getPeers().length), {
        timeout: 20000
      }).toBe(1)

      expect(pageErrors).toEqual([])
    } finally {
      await alice.close()
      await bob.close()
    }
  })

  test('opening an invite link connects without pressing anything', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      const invite = await createInvite(offerer)

      // The tester could not find the textarea at all. Opening the link has to
      // do everything: start the node, verify the invite, produce the reply.
      answerer.on('pageerror', error => pageErrors.push(error.message))
      const url = new URL(invite)
      url.search = '?ice=host'
      await answerer.goto(url.toString())

      await expect(answerer.locator('#invite-box')).toBeVisible({ timeout: 30000 })
      const reply = await answerer.locator('#invite-link').inputValue()
      expect(reply).toMatch(/#r=/)

      await useLink(offerer, reply)
      await expect(offerer.locator('#status')).toContainText('Connected')

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('a link wrapped by a messenger still works', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      const invite = await createInvite(offerer)
      // Chat apps wrap long strings. Before this was handled, a wrapped paste
      // failed as "cannot be decoded", which reads like a corrupt payload.
      const wrapped = invite.replace(/(.{40})/g, '$1\n')

      await useLink(answerer, wrapped)
      await expect(answerer.locator('#invite-box')).toBeVisible()

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('explains a reply that has no invite waiting', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const stranger = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)
      await openPeer(stranger, pageErrors)

      const invite = await createInvite(offerer)
      await useLink(answerer, invite)
      const reply = await replyLinkOf(answerer)

      // This is the exact dead end from the field test, where the browser said
      // "Called in wrong state: stable" and the tester had no idea what to do.
      await useLink(stranger, reply)

      // Clicking dispatches; the handling is async, so poll rather than read.
      const status = stranger.locator('#status')
      await expect(status).toContainText(/invite/i)
      await expect(status).not.toContainText('wrong state')
      await expect(status).not.toContainText('setRemoteDescription')

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
      await stranger.close()
    }
  })

  test('the answering peer waits on a messenger timescale, not a same-room one', async ({ browser, browserName }) => {
    // The teardown that used to fire here is a plain timer, not engine
    // behaviour, so this waits out the old 30 second limit once rather than
    // three times.
    test.skip(browserName !== 'chromium', 'timer behaviour, not engine behaviour')

    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      const invite = await createInvite(offerer)
      await useLink(answerer, invite)
      await replyLinkOf(answerer)

      // The answering peer used to close its own connection 30 seconds after
      // replying, which is guaranteed to expire while the other person is still
      // switching apps - and then their reply could never land. Nothing may tear
      // the connection down while the reply is in transit.
      await answerer.waitForTimeout(35000)
      await expect(answerer.locator('#status')).not.toContainText('expired')

      await useLink(offerer, await replyLinkOf(answerer))
      await expect(offerer.locator('#status')).toContainText('Connected')

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('a reply opened in a second tab reports back what happened', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    // BroadcastChannel is per browser context, so all three pages share one.
    const context = await browser.newContext()
    const offerer = await context.newPage()
    const answerer = await context.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      const invite = await createInvite(offerer)
      await useLink(answerer, invite)
      const reply = await replyLinkOf(answerer)

      // Tapping a reply link in a messenger opens a fresh tab, which can never
      // finish the handshake itself - the pending connection lives in the tab
      // that made the invite. It hands it over, and then has to say so, or it
      // looks like a page where nothing happened.
      const secondTab = await context.newPage()
      secondTab.on('pageerror', error => pageErrors.push(error.message))
      const url = new URL(reply)
      url.search = '?ice=host'
      await secondTab.goto(url.toString())

      const banner = secondTab.locator('#handoff-banner')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText('Connected in your other tab', { timeout: 30000 })
      await expect(banner).toContainText('close this one')

      // ...and the connection really is in the original tab, not this one.
      await expect.poll(() => offerer.evaluate(() => window.__libp2pQrTest.getConnections()), {
        timeout: 20000
      }).toBe(1)

      expect(pageErrors).toEqual([])
    } finally {
      await context.close()
    }
  })

  test('shows how fresh the invite is', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)
      await createInvite(page)

      // 27 minutes passed between invite and reply in the field test, and
      // nothing ever said an invite has a shelf life.
      await expect(page.locator('#invite-freshness')).toContainText(/fresh for about \d+ more minute/)

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('shows a pending state while the invite is being created', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)

      const createOffer = page.locator('#create-offer')
      await expect(createOffer).toHaveText('Create invite link')

      await createOffer.click()
      await expect(page.locator('#invite-box')).toBeVisible()

      // Gathering ICE is too fast here to catch the spinner mid-flight, so the
      // page records that the state was entered at all. Asserting only the end
      // state would pass even if the pending state were never shown.
      expect(await page.evaluate(() => window.__libp2pQrTest.wasBusy('create-offer'))).toBe(true)

      await expect(createOffer).toHaveAttribute('aria-busy', 'false')
      await expect(createOffer).toBeEnabled()

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('does not push the page sideways on a phone once connected', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const offerer = await browser.newPage({ viewport: { width: 390, height: 780 } })
    const answerer = await browser.newPage({ viewport: { width: 390, height: 780 } })
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)
      await connectPeers(offerer, answerer)

      // The connected state is a different layout - folded headings, a peer
      // list, long peer ids - and it went 543px wide on a 390px screen. An
      // unconnected page cannot catch that, which is why it shipped.
      for (const page of [offerer, answerer]) {
        const width = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          view: window.innerWidth
        }))
        expect(width.scroll, `page is ${width.scroll}px wide in a ${width.view}px viewport`)
          .toBeLessThanOrEqual(width.view)
      }

      expect(pageErrors).toEqual([])
    } finally {
      await offerer.close()
      await answerer.close()
    }
  })

  test('renders the QR code edge to edge on a phone', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)
      await createInvite(page)

      // The link lands in the box before the code is drawn, and a split code
      // has a library to fetch first - so wait for the image, do not race it.
      await expect(page.locator('qr-invite img')).toBeVisible({ timeout: 30000 })

      // Module size decides whether a scan catches. Anything much below the
      // full viewport width is width given away to page margins.
      const width = await page.locator('qr-invite img').evaluate(img => img.clientWidth)
      expect(width).toBe(390)

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
  })

  test('the compact payload fits one code where the full one needs an animation', async ({ page, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const pageErrors = []

    await openPeer(page, pageErrors)

    // Measured, and the measurement corrected a claim rather than confirming it.
    //
    // "A smaller payload draws a sparser code" is only true up to 600
    // characters. Above that <qr-invite> splits into a BC-UR sequence, and every
    // frame in that sequence is small by construction - so a v2 payload does not
    // draw a *denser* code than a compact one, it draws several codes of about
    // the same density, one after another.
    //
    // The benefit is therefore not a sparser symbol. It is that the invitation
    // fits in **one** symbol at all: a single glance instead of holding a phone
    // steady through an animation. That is what this test pins down.
    const measure = async () => {
      await page.evaluate(() => {
        window.__render = new Promise(resolve => {
          document.querySelector('qr-invite')
            .addEventListener('render', event => resolve(event.detail), { once: true })
        })
      })
      await createInvite(page)
      return page.evaluate(() => window.__render)
    }

    // Default first, which is now the full payload, then the compact one behind
    // the checkbox. The order follows the default so this test would notice a
    // silent flip of it.
    const full = await measure()

    // The invite modal is open over the setup card, so the checkbox behind it is
    // not clickable until it is dismissed.
    await page.keyboard.press('Escape')
    await expect(page.locator('#invite-box')).toBeHidden()
    await page.locator('#compact-payload').check()

    const compact = await measure()

    // Recorded, so a regression that quietly grows the payload is visible in the
    // log rather than only when it crosses a threshold.
    console.log(
      `compact: ${compact.characters} chars, ${compact.modules} modules, ${compact.frames} frame(s)\n` +
      `v2:      ${full.characters} chars, ${full.modules} modules, ${full.frames} frame(s)`
    )

    // The payload claim of #6: an order of magnitude, or close to it.
    expect(compact.characters).toBeLessThan(full.characters / 3)

    // The claim that actually matters at a counter. One static code against a
    // multi-frame animation - this is the difference a person feels, and it is
    // the one the character count is a proxy for.
    expect(compact.frames).toBe(1)
    expect(full.frames).toBeGreaterThan(1)

    // Module counts are recorded above and deliberately not asserted against each
    // other. Comparing one whole code against one frame of five is not a
    // like-for-like measurement - a frame of five is small because it is a fifth,
    // not because the format is better - and the numbers say so: on Firefox,
    // which gathers more candidates, the compact code is 73 modules against 69
    // per animation frame. Larger, and still the easier code to scan, because
    // there is one of it.

    expect(pageErrors).toEqual([])
  })

  test('transfers a dropped file over bitswap and offers it as a download', async ({ browser, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const sender = await browser.newPage()
    const receiver = await browser.newPage()
    const pageErrors = []
    const CONTENT = 'these bytes were pulled over bitswap, not over a gateway'

    try {
      await openPeer(sender, pageErrors)
      await openPeer(receiver, pageErrors)
      await connectPeers(sender, receiver)

      // Only the sender holds the block. The receiver has no routers and no
      // gateways configured, so bitswap over the QR connection is the only way
      // these bytes can arrive.
      const cid = await sender.evaluate(text => {
        return window.__libp2pQrTest.sendFile('notes.txt', text)
      }, CONTENT)
      expect(cid).toMatch(/^bafk|^bafy|^Qm/)

      // Bitswap needs wantlist round trips between two browser nodes, and the
      // CI runner carries the whole serialised suite. It takes ~11s locally.
      // TEMPORARY DIAGNOSTIC
      let got = 0
      for (let k = 0; k < 40 && got === 0; k++) {
        await receiver.waitForTimeout(3000)
        got = await receiver.evaluate(() => window.__libp2pQrTest.getReceivedFiles().length)
      }
      if (got === 0) {
        console.log('FAILDUMP sender=' + JSON.stringify(await sender.evaluate(() => window.__libp2pQrTest.diagnose())))
        console.log('FAILDUMP receiver=' + JSON.stringify(await receiver.evaluate(() => window.__libp2pQrTest.diagnose())))
        console.log('FAILDUMP errors=' + JSON.stringify(pageErrors.slice(0, 6)))
      }
      expect(got).toBe(1)

      const downloaded = await receiver.evaluate(value => {
        return window.__libp2pQrTest.readReceivedFile(value)
      }, cid)
      expect(downloaded).toBe(CONTENT)

      expect(pageErrors).toEqual([])
    } finally {
      await sender.close()
      await receiver.close()
    }
  })

  test('a folded step 1 still says which peer you are', async ({ page, browserName }) => {
    skipWithoutWebRTC(test, browserName)

    const pageErrors = []

    await openPeer(page, pageErrors)

    const full = await page.locator('#peer-id').textContent()

    expect(full).toMatch(/^12D3KooW/)

    // Folding is what the app does by itself once you are connected; clicking is
    // the same state, reachable without a second peer.
    await page.locator('#step-start .step-heading').click()
    await expect(page.locator('#step-start')).toHaveClass(/is-collapsed/)

    // The whole point: a collapsed card hides every child but the heading, so an
    // id that lives under two disclosures disappears exactly when it stops being
    // easy to find. Which peer you are is what the other side checks a signature
    // against.
    const brief = page.locator('#peer-id-brief')

    await expect(brief).toBeVisible()
    await expect(brief).toHaveAttribute('title', full)

    // Head *and* tail: every id here starts `12D3KooW`, so a prefix alone would
    // identify nothing and two devices could not be told apart.
    await expect(brief).toContainText(full.slice(0, 8))
    await expect(brief).toContainText(full.slice(-6))

    expect(pageErrors).toEqual([])
  })

  test('reading the specification does not switch the format on', async ({ page }) => {
    await page.goto('/')

    const box = page.locator('#compact-payload')

    await expect(box).not.toBeChecked()

    // A link inside a <label> is a trap. If the label forwards the activation,
    // following it to read what QWBP is would silently change what this device
    // hands out - and the person would find out when an older peer could not
    // read their code.
    const link = page.locator('label.option a[href*="qwbp"]')

    await expect(link).toHaveAttribute('href', /magarcia\.github\.io\/qwbp/)

    const [popup] = await Promise.all([
      page.context().waitForEvent('page').catch(() => null),
      link.click()
    ])

    await popup?.close()
    await expect(box).not.toBeChecked()
  })

  test('the short code is a quarter the size, and the box is what decides', async ({ browser }) => {
    const page = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(page, pageErrors)

      // Off by default while #6 is open - a connection built from a
      // reconstructed SDP goes silent under load - so the default is the full
      // payload and the box is what opts in.
      await expect(page.locator('#compact-payload')).not.toBeChecked()

      await page.locator('#create-offer').click()
      await expect(page.locator('#invite-box')).toBeVisible({ timeout: 30000 })

      // Not `.not.toMatch(/q3/)`: the field is emptied while an invite gathers,
      // and an empty string does not match either - so that poll passes
      // instantly on nothing at all, which is exactly what it did.
      await expect.poll(
        async () => {
          const value = await page.locator('#invite-link').inputValue()
          return value.includes('#i=') && !value.includes('#i=q3')
        },
        { timeout: 30000 }
      ).toBe(true)

      const full = (await page.locator('#invite-link').inputValue()).length

      // The invite is a modal, so the page behind it is inert - which is the
      // point of a modal and the reason the box cannot simply be clicked.
      await page.keyboard.press('Escape')
      await expect(page.locator('#invite-box')).toBeHidden()

      await page.locator('#compact-payload').check()
      await page.locator('#create-offer').click()
      await expect(page.locator('#invite-box')).toBeVisible({ timeout: 30000 })
      await expect.poll(() => page.locator('#invite-link').inputValue()).toMatch(/#i=q3/)

      const compact = (await page.locator('#invite-link').inputValue()).length

      // Printed, not just asserted: the number is what the whole change is for,
      // and a regression that doubled it while staying under a generous ceiling
      // would otherwise pass unnoticed.
      console.log(`invite link: ${compact} characters compact, ${full} full`)

      expect(compact).toBeLessThan(full / 2)
      expect(compact).toBeLessThan(400)
    } finally {
      await page.close()
      expect(pageErrors).toEqual([])
    }
  })

  test('rejects a compact offer whose fingerprint was altered', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      // The box decides the format and is off by default, so this test has to
      // ask for the thing it is about.
      await offerer.locator('#compact-payload').check()

      const offerPayload = await offerer.evaluate(() => window.__libp2pQrTest.createOfferPayload())

      expect(offerPayload.startsWith('q3:')).toBe(true)

      // Byte 2 is the first byte of the DTLS fingerprint. This is the field the
      // whole security argument rests on - a valid signature over it is what
      // binds the WebRTC session to the Peer ID and lets the transport skip the
      // Noise handshake. Flipping one bit of it has to be fatal, and it has to
      // be fatal *here*, in the app, not only in a unit test.
      const bytes = Buffer.from(offerPayload.slice('q3:'.length), 'base64url')

      bytes[2] ^= 1

      const tampered = `q3:${bytes.toString('base64url')}`
      const errorMessage = await answerer.evaluate(async offer => {
        try {
          await window.__libp2pQrTest.acceptOfferPayload(offer)
          return null
        } catch (error) {
          return error.message
        }
      }, tampered)

      expect(errorMessage).toContain('signature is invalid')
    } finally {
      await offerer.close()
      await answerer.close()
      expect(pageErrors).toEqual([])
    }
  })

  test('rejects a modified signed offer', async ({ browser }) => {
    const offerer = await browser.newPage()
    const answerer = await browser.newPage()
    const pageErrors = []

    try {
      await openPeer(offerer, pageErrors)
      await openPeer(answerer, pageErrors)

      // The v2 shape: this tamper works by editing the transported SDP, which a
      // compact payload does not have. Both formats have to stay guarded, so
      // this one asks for v2 and the test above covers v3.
      await offerer.locator('#compact-payload').uncheck()

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

  test('a consumer can translate the status rows without losing the others', async ({ page }) => {
    // The proof that #51 actually landed, at the element rather than at the
    // helper: the labels were module constants with no way in, and the demo
    // never noticed because the demo is English.
    await page.goto('/')
    await page.locator('#start-client').click()
    await expect(page.locator('qr-status')).toBeVisible({ timeout: 30000 })

    const label = row => page.locator(`qr-status .line:nth-child(${row}) button span:first-child`)

    await expect(label(1)).toHaveText('Browser')

    await page.evaluate(() => {
      document.querySelector('qr-status').strings = { camera: 'Kamera' }
    })

    // The one that was translated, and the ones that were not.
    await expect(page.locator('qr-status .line button span:first-child').nth(3)).toHaveText('Kamera')
    await expect(label(1)).toHaveText('Browser')
    await expect(label(2)).toHaveText('IPv4')
  })
})

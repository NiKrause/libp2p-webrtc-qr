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

  await expect(page.locator('#invite-box')).toBeVisible()
  // The box is emptied while the next invite is gathering, so waiting for any
  // `#i=` would otherwise hand back the previous person's link.
  await expect.poll(() => page.locator('#invite-link').inputValue()).toMatch(/#i=/)

  return page.locator('#invite-link').inputValue()
}

async function useLink (page, link) {
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
      await expect(hub.locator('#peer-list .peer-row')).toHaveCount(2)
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

      await expect(alice.locator('.peer-health')).toContainText('connected')

      // A phone whose radio slept, or whose peer went away, comes back to a
      // page that used to look perfectly fine and say nothing.
      // A phone whose radio slept, or a tab the OS discarded: the connection
      // ends underneath a page that otherwise keeps looking perfectly fine.
      const peerId = await alice.evaluate(() => window.__libp2pQrTest.getPeers()[0])
      await alice.evaluate(id => window.__libp2pQrTest.simulateConnectionLoss(id), peerId)

      await expect(alice.locator('#status')).toContainText('Lost the connection')
      await expect(alice.locator('#status')).toContainText('create a new invite')

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

      const state = page.locator('#network-state')
      await expect(state).toBeVisible({ timeout: 30000 })
      await expect(state).toHaveClass(/is-(open|symmetric|blocked|relay)/)
      expect((await state.textContent()).length).toBeGreaterThan(20)

      // One LED per address family, plus the summary. Each has to reach a real
      // verdict - an unlit dot means the probe never finished.
      for (const id of ['#network-ipv4', '#network-ipv6', '#network-overall']) {
        const line = page.locator(id)

        await expect(line).toHaveClass(/is-(open|symmetric|blocked|relay)/)
        expect((await line.locator('.network-text').textContent()).length).toBeGreaterThan(20)
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

  test('the summary LED is green when either family is usable', async ({ browser }) => {
    const page = await browser.newPage()

    try {
      await page.goto('/')
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.summariseNetwork === 'function')

      const verdicts = await page.evaluate(() => {
        const combine = window.__libp2pQrTest.summariseNetwork
        const cases = [
          ['open', 'open'],
          ['open', 'blocked'],
          ['blocked', 'open'],
          ['symmetric', 'open'],
          ['relay', 'blocked'],
          ['symmetric', 'blocked'],
          ['blocked', 'blocked']
        ]

        return cases.map(([v4, v6]) => [v4, v6, combine(v4, v6).state])
      })

      const green = new Set(['open', 'relay'])

      for (const [v4, v6, overall] of verdicts) {
        // IPv6 alone is enough: it does not care that IPv4 sits behind a
        // carrier NAT, so a green anywhere makes the summary green.
        expect(green.has(overall), `${v4}/${v6} -> ${overall}`)
          .toBe(green.has(v4) || green.has(v6))
      }

      expect(verdicts.find(([v4, v6]) => v4 === 'symmetric' && v6 === 'blocked')[2]).toBe('symmetric')
      expect(verdicts.find(([v4, v6]) => v4 === 'blocked' && v6 === 'blocked')[2]).toBe('blocked')
    } finally {
      await page.close()
    }
  })

  test('only globally routable IPv6 counts as an IPv6 path', async ({ browser }) => {
    const page = await browser.newPage()

    try {
      await page.goto('/')
      await page.waitForFunction(() => typeof window.__libp2pQrTest?.isGlobalUnicastV6 === 'function')

      const results = await page.evaluate(() => {
        const check = window.__libp2pQrTest.isGlobalUnicastV6

        return {
          global: check('2a02:810d:f486:ae00:7c06:bad5:54fc:1876'),
          bracketed: check('[2606:4700:49::1]'),
          threePrefix: check('3ffe:1900:4545:3:200:f8ff:fe21:67cf'),
          uniqueLocal: check('fd12:3456:789a::1'),
          linkLocal: check('fe80::1c2b:3f4a:5e6d:7f8a'),
          ipv4: check('188.194.232.23'),
          mdns: check('c4fd82a7-dd21-474a-86cc-a61d78d36829.local'),
          missing: check(null)
        }
      })

      expect(results).toEqual({
        global: true,
        bracketed: true,
        threePrefix: true,
        uniqueLocal: false,
        linkLocal: false,
        ipv4: false,
        mdns: false,
        missing: false
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

      // The QR carries the link too, so a phone's own camera app opens the page
      // with the payload already loaded instead of needing the in-app scanner.
      await expect(page.locator('#qr-image')).toBeVisible()
      // Polled, not read once: decoding a dense code off a canvas occasionally
      // sees a frame that has not finished painting and yields null. Retrying
      // does not weaken the assertion - a QR with the wrong contents still
      // never matches.
      await expect.poll(async () => {
        return page.evaluate(async dataUrl => {
          return window.__libp2pQrTest.decodeQrDataUrl(dataUrl)
        }, await page.locator('#qr-image').getAttribute('src'))
      }, { timeout: 20000 }).toBe(invite)

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

      // Module size decides whether a scan catches. Anything much below the
      // full viewport width is width given away to page margins.
      const width = await page.locator('#qr-image').evaluate(img => img.clientWidth)
      expect(width).toBe(390)

      expect(pageErrors).toEqual([])
    } finally {
      await page.close()
    }
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
      await expect.poll(async () => {
        return receiver.evaluate(() => window.__libp2pQrTest.getReceivedFiles().length)
      }, { timeout: 120000 }).toBe(1)

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

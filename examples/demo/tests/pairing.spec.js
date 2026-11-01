import { expect, test } from '@playwright/test'

/**
 * Scenario B: two devices, two networks, two people - and one measurement.
 *
 * A and C are solo. One person holds both phones, points one at the other, and
 * knows perfectly well which two rows belong together. B is the one that cannot
 * be walked through by a checklist: the other end is somebody else's phone, in
 * somebody else's flat, writing to somebody else's logbook. Nothing afterwards
 * says which of their rows was the other half of yours.
 *
 * So the thing being tested here is mostly an identifier and where it travels.
 * The claim is "both ends contribute their half to the same record" (#179), and
 * it is false the moment either half is missing the id - which is how the hole
 * these specs also cover was found: the label travelled by link and not by
 * anything else, so the half that scanned or pasted went in unlabelled.
 */

const open = async (page, { query = '', record = true } = {}) => {
  await page.goto(`/?ice=host&view=technical&intro=off${query}`)

  if (record) {
    await page.locator('#logbook-enabled').check()
    await expect(page.locator('#logbook-enabled')).toBeChecked()
  }

  await page.locator('#start-client').click()
  await page.waitForFunction(() => document.getElementById('peer-id').textContent !== 'not started')
}

const pick = (page, value) => page.locator(`input[name="scenario"][value="${value}"]`).check()

const inviteLink = async page => {
  await page.locator('#create-offer').click()
  await expect(page.locator('#invite-box')).toBeVisible({ timeout: 60000 })

  return page.locator('#invite-link').inputValue()
}

const pairOf = page => page.evaluate(() => window.__libp2pQrTest.pairId())

test.describe('scenario B, which needs two people', () => {
  test('B is offered, and its brief says what it needs that A does not', async ({ page }) => {
    await open(page)
    await pick(page, 'across-networks')

    const brief = page.locator('#scenario-brief')

    await expect(brief).toBeVisible()
    // The precondition that decides whether the run means anything: one person
    // tethering the other is scenario A wearing B's label.
    await expect(brief).toContainText(/second person/i)
    await expect(brief).toContainText(/hotspot/i)
    // And the one that is pure WebRTC: an offer's candidates go stale with the
    // NAT bindings behind them, so "I'll answer it tonight" is not a run.
    await expect(brief).toContainText(/stale|minutes/i)
  })

  test('both ends of a B run write the same pairing id', async ({ page, context }) => {
    await open(page)
    await pick(page, 'across-networks')

    const link = await inviteLink(page)
    const mine = await pairOf(page)

    // Eight characters in the fragment, beside the label and behind the same
    // condition: a run nobody labelled carries neither.
    expect(mine).toMatch(/^[a-z0-9]{8}$/)
    expect(link).toContain(`p=${mine}`)
    expect(link).toContain('s=across-networks')

    const far = await context.newPage()

    await far.goto(link)
    await far.waitForFunction(() => window.__libp2pQrTest != null)

    // The whole claim: the other device did not have to be told anything, and
    // its row is recognisably the other half of this one.
    await expect.poll(() => pairOf(far), { timeout: 60000 }).toBe(mine)
    expect(await far.evaluate(() => window.__libp2pQrTest.scenario())).toBe('across-networks')
  })

  test('an unlabelled run is paired with nothing, because it is nobody\'s measurement', async ({ page }) => {
    await open(page)

    const link = await inviteLink(page)

    expect(link).not.toContain('p=')
    expect(await pairOf(page)).toBeNull()
  })

  test('a pasted link carries the pair, not only an opened one', async ({ page, context }) => {
    // The hole this closes: the QR encodes the link, so a scanned code has
    // carried the label all along - but only the link-opening path read it.
    // Scanning somebody's code, which is how scenario A is actually run, wrote
    // an unlabelled and unpaired row on the scanning side.
    await open(page)
    await pick(page, 'across-networks')

    const link = await inviteLink(page)
    const mine = await pairOf(page)

    const far = await context.newPage()

    await open(far, { record: false })
    await far.locator('.paste-fallback summary').click()
    await far.locator('#payload-display').fill(link)
    await far.locator('#process-payload').click()

    await expect.poll(() => pairOf(far), { timeout: 60000 }).toBe(mine)
    expect(await far.evaluate(() => window.__libp2pQrTest.scenario())).toBe('across-networks')
  })

  test('a reply pasted into an open attempt cannot hand it a different pair', async ({ page }) => {
    await open(page)
    await pick(page, 'across-networks')

    await inviteLink(page)

    const mine = await pairOf(page)

    // A link with somebody else's id and a payload that cannot be decoded: the
    // attempt fails, which is the point - what must not happen is that the id
    // in the pasted link is adopted, here or by whatever starts next.
    await page.locator('#paste-reply').click()
    await page.locator('#payload-display').fill('https://example.org/#r=q3:nonsense&s=same-lan&p=zzzz1111')
    await page.locator('#process-payload').click()

    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('webrtc-qr.logbook.v1') ?? '[]')), { timeout: 30000 })
      .toHaveLength(1)

    const [entry] = await page.evaluate(() => JSON.parse(localStorage.getItem('webrtc-qr.logbook.v1') ?? '[]'))

    expect(entry.pairId).toBe(mine)
    expect(entry.scenario).toBe('across-networks')
  })

  test('the invite goes out with instructions, because nobody is there to give them', async ({ page }) => {
    await open(page)
    await pick(page, 'across-networks')
    await inviteLink(page)

    const note = page.locator('#pair-note')

    await expect(note).toBeVisible()
    await expect(note).toContainText(/not in the room/i)
  })

  test('copying and sharing put the same thing in the chat', async ({ page }) => {
    await open(page)
    await pick(page, 'across-networks')

    const link = await inviteLink(page)
    const sent = await page.evaluate(() => window.__libp2pQrTest.handoverText())

    // Which control is on screen depends on whether the browser has a share
    // sheet. What the other person receives must not.
    expect(sent).toContain(link)
    expect(sent).toMatch(/your own network/i)
  })

  test('a reply goes back bare, to somebody who already knows what it is', async ({ page, context }) => {
    await open(page)
    await pick(page, 'across-networks')

    const link = await inviteLink(page)
    const far = await context.newPage()

    await far.goto(link)
    // Their dialog shows the reply, not an invite.
    await expect(far.locator('#invite-link')).toHaveValue(/#r=/, { timeout: 60000 })

    const sent = await far.evaluate(() => window.__libp2pQrTest.handoverText())

    expect(sent).toBe(await far.locator('#invite-link').inputValue())
    await expect(far.locator('#pair-note')).toContainText(/send this back/i)
  })

  test('a solo scenario gets no handover note, having nobody to hand it to', async ({ page }) => {
    await open(page)
    await pick(page, 'same-lan')
    await inviteLink(page)

    await expect(page.locator('#pair-note')).toBeHidden()
  })

  test('the note is in the language the page is in', async ({ page }) => {
    await open(page)
    // Before the invite, because the note is painted with the dialog and the
    // dialog is not repainted under somebody who is already reading it.
    await page.locator('#locale-de').click()
    await pick(page, 'across-networks')
    await inviteLink(page)

    await expect(page.locator('#pair-note')).toContainText(/steht nicht neben Ihnen/i)
  })

  test('the row says which pair it was half of', async ({ page }) => {
    await open(page)

    // An invite that arrived from somewhere, carrying its labels, and a payload
    // that cannot be decoded - so the row closes immediately and says what it
    // was part of. The answering side never mints an id: it has one because it
    // was sent one, which is the only way its row joins anything.
    await page.locator('.paste-fallback summary').click()
    await page.locator('#payload-display').fill('https://example.org/#i=q3:nonsense&s=across-networks&p=abcd1234')
    await page.locator('#process-payload').click()

    const row = page.locator('.logbook-entry').first()

    await expect(row).toBeVisible({ timeout: 30000 })
    // The only thing in the row that points at a measurement rather than at
    // this device, so it is worth the width it takes.
    await expect(row.locator('.logbook-how')).toContainText('pair abcd1234')
  })
})

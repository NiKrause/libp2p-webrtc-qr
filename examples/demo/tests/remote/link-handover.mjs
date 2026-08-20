/**
 * The link handover, between two browsers that are not each other's neighbours.
 *
 * Every other test in this suite runs both peers in one process on one machine,
 * so they share a NAT and the reflexive candidates they exchange are two views
 * of the same box. That configuration cannot fail the way the reported bug
 * fails - it has no second network to cross - which is why a suite that was
 * green throughout could sit alongside two phones that would not connect.
 *
 * This scenario takes the browsers as arguments and never creates one, so the
 * same code runs with two local browsers (fast, still not a real crossing) and
 * with one browser on a remote machine (slow, and the only version that proves
 * anything about NAT). What it asserts is identical either way.
 *
 * Both payload formats are covered because they are different wires: the
 * compact one derives ICE credentials from the fingerprint and rebuilds the SDP
 * locally, so a candidate that survives one is not evidence about the other.
 */

const REPLY_TIMEOUT = 90_000

const withoutIntro = url => {
  try {
    const parsed = new URL(url)
    parsed.searchParams.set('intro', 'off')
    return parsed.toString()
  } catch {
    // Not absolute - a relative path from the local spec. Appending is enough.
    return url + (url.includes('?') ? '&' : '?') + 'intro=off'
  }
}

const inviteOf = async (page, { compact }) => {
  // Press Start only where there is one to press.
  //
  // The simple view folds starting into the invite button, so step 1 is not on
  // screen; the technical view keeps them apart and the invite button stays
  // disabled until Start has been used. This helper also runs against a
  // deployed build that may predate the switch entirely, so it asks the page
  // rather than assuming any of the three.
  const start = page.locator('#start-client')

  if (await start.isVisible().catch(() => false)) {
    await start.click()
  }

  // The box is per-offer, so it has to be set before the invite is made.
  const box = page.locator('#compact-payload')

  if (await box.count() > 0) {
    await box.setChecked(compact)
  }

  await page.locator('#create-offer').click()
  await page.locator('#invite-box').waitFor({ state: 'visible', timeout: REPLY_TIMEOUT })
  await waitForValue(page.locator('#invite-link'), /#i=/, REPLY_TIMEOUT)

  return page.locator('#invite-link').inputValue()
}

const waitForValue = async (locator, pattern, timeout) => {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const value = await locator.inputValue().catch(() => '')

    if (pattern.test(value)) {
      return value
    }

    await new Promise(resolve => setTimeout(resolve, 400))
  }

  throw new Error(`Timed out waiting for a value matching ${pattern}`)
}

const applyReply = async (page, reply) => {
  // While the invite is on screen the page behind it is inert, so the way to
  // the paste field is the button inside the dialog - exactly as a person
  // coming back from a messenger would find it.
  if (await page.locator('#invite-box[open]').count() > 0) {
    await page.locator('#paste-reply').click()
  } else {
    await page.locator('.paste-fallback').evaluate(details => { details.open = true })
  }

  await page.locator('#payload-display').fill(reply)
  await page.locator('#process-payload').click()
}

const say = async (page, message) => {
  await page.locator('#message').fill(message)
  await page.locator('#send').click()
}

const heard = async (page, message, timeout = REPLY_TIMEOUT) => {
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    const text = await page.locator('#chat-log').textContent().catch(() => '')

    if (text.includes(message)) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  throw new Error(`Timed out waiting for "${message}" to arrive`)
}

/**
 * Run one handover and return what it took.
 *
 * The timings are the point of running this remotely at all: locally the
 * numbers are meaningless, and across two networks they say which half of the
 * handshake is slow - gathering, or the crossing itself.
 *
 * @param {object} options
 * @param {import('playwright').Browser} options.browserA the side that invites
 * @param {import('playwright').Browser} options.browserB the side that answers
 * @param {string} options.appUrl
 * @param {boolean} options.compact which payload format to exercise
 */
export async function runLinkHandover ({ browserA, browserB, appUrl, compact }) {
  const contextA = await browserA.newContext()
  const contextB = await browserB.newContext()
  const a = await contextA.newPage()
  const b = await contextB.newPage()
  const started = Date.now()
  const timings = {}

  try {
    // A first visit opens the introduction, and a modal blocks every click
    // behind it. Added here rather than by each caller because this helper
    // always wants a page it can drive; an older deployment that does not know
    // the flag ignores it.
    await a.goto(withoutIntro(appUrl))
    const invite = await inviteOf(a, { compact })
    timings.inviteMs = Date.now() - started

    // Opening the link *is* the flow: B arrives from a chat with no prior visit,
    // which is the path that starts the peer and answers in one go.
    const openedAt = Date.now()
    await b.goto(invite)
    await waitForValue(b.locator('#invite-link'), /#r=/, REPLY_TIMEOUT)
    const reply = await b.locator('#invite-link').inputValue()
    timings.replyMs = Date.now() - openedAt

    const appliedAt = Date.now()
    await applyReply(a, reply)

    // A message each way, because a data channel that opens and then carries
    // nothing is a connection only in the status line.
    await say(a, 'from the inviting side')
    await heard(b, 'from the inviting side')
    await say(b, 'from the answering side')
    await heard(a, 'from the answering side')
    timings.connectMs = Date.now() - appliedAt

    return { compact, timings, inviteLength: invite.length }
  } finally {
    await contextA.close().catch(() => {})
    await contextB.close().catch(() => {})
  }
}

/** Both formats, in sequence, so one report covers the pair. */
export async function runBothFormats ({ browserA, browserB, appUrl }) {
  const results = []

  for (const compact of [false, true]) {
    results.push(await runLinkHandover({ browserA, browserB, appUrl, compact }))
  }

  return results
}

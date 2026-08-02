/**
 * Keep the screen awake while a connection is live.
 *
 * A phone that sleeps takes its connections with it, and there is no way to
 * resume them without a signalling path - so the cheapest fix by far is to stop
 * the screen sleeping in the first place. This covers the common case: a phone
 * dozing off because nobody touched it while the other person was reading.
 *
 * It does *not* cover someone deliberately locking their phone, and it should
 * not pretend to. The lock is also released by the browser whenever the page
 * stops being visible, which is why it has to be re-acquired on the way back.
 */
let lock = null
let wanted = false

/**
 * `wanted` is our decision, `held` is the browser's answer to it. They are
 * reported separately because only the first is ours to get right: a headless
 * browser exposes the API and then refuses every request, having no screen to
 * keep awake, so asserting on `held` would be asserting on the platform.
 */
export function state () {
  return {
    supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
    wanted,
    held: lock != null
  }
}

/**
 * @param active - whether any connection is currently live
 */
export async function sync (active) {
  wanted = active

  if (!wanted || document.visibilityState !== 'visible') {
    await release()
    return
  }

  await acquire()
}

async function acquire () {
  if (!state().supported || lock != null) {
    return
  }

  try {
    const held = await navigator.wakeLock.request('screen')

    // The request can resolve after the page has already gone away again, in
    // which case holding on to it would leave a lock nobody asked for.
    if (!wanted || document.visibilityState !== 'visible') {
      await held.release().catch(() => {})
      return
    }

    held.addEventListener('release', () => {
      if (lock === held) {
        lock = null
      }
    })

    lock = held
  } catch {
    // Denied, unsupported in this context, or the document was not visible
    // after all. Nothing here is worth interrupting the user over.
  }
}

async function release () {
  const held = lock

  lock = null

  if (held != null) {
    await held.release().catch(() => {})
  }
}

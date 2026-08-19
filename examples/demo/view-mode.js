/**
 * Simple by default, technical on request.
 *
 * This page has one story - show a code, let somebody scan it, talk - and
 * almost everything else on it serves a different reader: someone checking that
 * libp2p came up, that the payload is the size it should be, that the
 * connection survived being backgrounded. Both readers are worth keeping and
 * only one of them should be met at the door.
 *
 * So this is a switch, not a deletion. **Nothing is removed, it is moved behind
 * one door**, and the door is labelled. The default is simple because the person
 * who needs `12D3KooW…` knows to go looking for it, and the person who does not
 * would never have learnt what it meant.
 *
 * Marked in the markup rather than listed here: a panel carries
 * `data-view="technical"` and this only flips one attribute on <html>. A list of
 * selectors in a module is a list that stops matching the page.
 */

// Exported so a spec pins the mode through storage rather than repeating the
// string - a literal in a test drifts silently when this one changes.
export const VIEW_MODE_STORAGE_KEY = 'webrtc-qr.simpleView'

let simple = true

/**
 * `?view=technical` wins over the stored choice, and does not overwrite it.
 *
 * A view is worth linking to - "look at this with the diagnostics on" is a
 * sentence people say - and a link that permanently changed the recipient's
 * preference would be a link that broke their app.
 *
 * It is also the only handle a test has. The specs open pages four different
 * ways (`page.goto`, `browser.newPage`, `context.newPage`, a fresh context),
 * so a fixture pins one of them and misses the rest; a URL is the one thing
 * every path passes through.
 */
function fromUrl () {
  try {
    const value = new URLSearchParams(location.search).get('view')
    if (value === 'simple') return true
    if (value === 'technical') return false
  } catch {
    // No location, or an unparseable one. Fall through to storage.
  }

  return null
}

function stored () {
  const url = fromUrl()
  if (url != null) return url

  try {
    // Anything other than an explicit "false" means simple, so a corrupted or
    // half-written value lands on the gentler side.
    return localStorage.getItem(VIEW_MODE_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function isSimple () {
  return simple
}

/**
 * @param {boolean} [next] omit to read the stored choice - which is what the
 *   first call on a page load wants, and what a `<select>` handler does not.
 */
export function applyViewMode (next) {
  simple = next == null ? stored() : next

  if (next != null) {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, String(simple))
    } catch {
      // Storage blocked: the choice holds for this session and no longer.
    }
  }

  document.documentElement.dataset.view = simple ? 'simple' : 'technical'

  return simple
}

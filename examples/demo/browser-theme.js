/**
 * Give each browser its own tint, so a tray full of them is not a guessing game.
 *
 * Two phones' worth of testing means five or six windows of the same page open
 * at once - Chrome, Firefox, DuckDuckGo, Safari, Brave, Opera - and pulling the
 * wrong one back from the background is a real, repeated waste. A distinct
 * pastel background per browser turns "which one was this?" into a glance.
 *
 * Detection is best-effort by design. User agents lie, Chromium forks all carry
 * "Chrome", and on Android DuckDuckGo often presents the plain system-WebView
 * string - so it can fall through to `chrome`. Getting it wrong tints two
 * windows the same; it breaks nothing. The one reliable signal is Brave's, which
 * exposes `navigator.brave.isBrave()`, so it is asked first.
 */

/**
 * @param {{ userAgent?: string, vendor?: string, brave?: boolean }} env
 * @returns {'brave'|'opera'|'edge'|'ddg'|'firefox'|'chrome'|'safari'|'other'}
 */
export function detectBrowser ({ userAgent = '', vendor = '', brave = false } = {}) {
  const ua = userAgent

  // Order matters: every Chromium fork's UA contains "Chrome", and every
  // Chromium UA contains "Safari", so the specific ones are ruled out first and
  // the generic ones - Chrome, then Safari - are the last resorts.
  if (brave) return 'brave'
  if (/\bOPR\/|\bOpera[/\s]/i.test(ua)) return 'opera'
  if (/\bEdg(?:A|iOS)?\//.test(ua)) return 'edge'
  if (/DuckDuckGo|\bDdg\//i.test(ua)) return 'ddg'
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox'
  if (/CriOS\/|Chrome\/|Chromium\//.test(ua)) return 'chrome'
  if (/Safari\//.test(ua) || /Apple/.test(vendor)) return 'safari'

  return 'other'
}

/**
 * Stamp the detected browser onto the root element, where the stylesheet keys
 * its per-browser tint off `[data-browser]`. Brave's check is a promise, so this
 * is async; the rest is synchronous and the value is available immediately after.
 *
 * @param {HTMLElement} [root]
 * @param {Navigator | { userAgent?: string, vendor?: string, brave?: any }} [nav]
 */
export async function applyBrowserTheme (root = document.documentElement, nav = navigator) {
  let brave = false

  try {
    brave = (await nav.brave?.isBrave?.()) === true
  } catch {
    // Not Brave, or the check is unavailable. Either way: not Brave.
  }

  const browser = detectBrowser({
    userAgent: nav.userAgent ?? '',
    vendor: nav.vendor ?? '',
    brave
  })

  root.dataset.browser = browser

  return browser
}

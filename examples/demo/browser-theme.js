/**
 * Give each browser its own tint, so a tray full of them is not a guessing game.
 *
 * Two phones' worth of testing means five or six windows of the same page open
 * at once - Chrome, Firefox, DuckDuckGo, Safari, Brave, Opera - and pulling the
 * wrong one back from the background is a real, repeated waste. A distinct
 * pastel background per browser turns "which one was this?" into a glance.
 *
 * Detection is best-effort by design: user agents lie, and every Chromium fork
 * carries "Chrome". Getting it wrong tints two windows the same, which breaks
 * nothing. The one signal that is not a string at all is Brave's
 * `navigator.brave.isBrave()`, so it is asked first.
 *
 * DuckDuckGo does name itself, on both platforms - checked against real strings
 * rather than assumed:
 *
 *   Android  … Version/4.0 Chrome/130.0.6723.106 Mobile DuckDuckGo/5 Safari/537.36
 *   iOS      … Version/18.6 Mobile/15E148 DuckDuckGo/7 Safari/605.1.15
 *
 * Both contain "Chrome" or "Safari" as well, which is exactly why the order
 * below matters.
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

import { resolveText } from './strings.js'

/**
 * The addresses behind a verdict, and what changed since last time.
 *
 * Two elements show this: `<qr-status>` beside its chips, and `<qr-intro>` in
 * the technical half of the first-run dialog. Copying it into both would put the
 * same sentence in two string tables, which is how a translation ends up saying
 * two different things about one thing.
 *
 * ## The diff is the feature, not the list
 *
 * A verdict answers "will this work". The list answers "what changed", which is
 * the question somebody has after switching a VPN on and one no summary can
 * answer. Eight addresses on a screen ask them to compare against a screen they
 * saw a minute ago from memory; `new` and `gone` answer it directly.
 *
 * Gone candidates stay on screen, struck through. A row that vanishes between
 * two probes is the most interesting thing this can show, and dropping it hides
 * exactly that.
 */

export const CANDIDATE_STRINGS = {
  details: 'Show the addresses this check found',
  detailsHint: 'What a peer would be offered as a route to this device. Turn a VPN on or off and check again - if anything changed, it changed here.',
  recheck: 'Check again',
  detailsEmpty: 'No candidates were gathered.',
  // Named rather than abbreviated: "srflx" is the word in the specification and
  // nowhere else, and this is read by people who are not reading it.
  candidateHost: 'this device',
  candidateSrflx: 'seen from outside',
  candidateRelay: 'via a relay',
  candidatePrflx: 'discovered mid-connection',
  candidateMdns: 'Addresses ending in .local are stand-ins the browser substitutes for this device\'s own address, so a web page cannot read it. They are not a fault and they are not the VPN.',
  candidateNew: 'new',
  candidateGone: 'gone'
}

export const CANDIDATE_STRINGS_DE = {
  details: 'Gefundene Adressen anzeigen',
  detailsHint: 'Welche Wege zu diesem Gerät einer Gegenstelle angeboten würden. Schalten Sie ein VPN ein oder aus und prüfen Sie erneut — wenn sich etwas geändert hat, dann hier.',
  recheck: 'Erneut prüfen',
  detailsEmpty: 'Es wurden keine Kandidaten gefunden.',
  candidateHost: 'dieses Gerät',
  candidateSrflx: 'von außen gesehen',
  candidateRelay: 'über ein Relay',
  candidatePrflx: 'während des Verbindens entdeckt',
  candidateMdns: 'Adressen, die auf .local enden, sind Platzhalter, die der Browser anstelle der echten Adresse dieses Geräts einsetzt, damit eine Webseite sie nicht lesen kann. Das ist kein Fehler und nicht das VPN.',
  candidateNew: 'neu',
  candidateGone: 'weg'
}

/** ICE's own words for where a candidate came from, in this panel's words. */
const KIND_KEYS = {
  host: 'candidateHost',
  srflx: 'candidateSrflx',
  relay: 'candidateRelay',
  prflx: 'candidatePrflx'
}

/** The styles both hosts need. Appended to each element's own sheet. */
export const CANDIDATE_STYLE = `
  .details { margin-top: 8px; }
  .details[hidden] { display: none; }

  .details summary {
    font-size: 0.78rem;
    color: var(--qr-candidate-dim, #a8b3c7);
    cursor: pointer;
  }

  .details summary:focus-visible {
    outline: 2px solid var(--qr-candidate-focus, #58c7f3);
    outline-offset: 3px;
  }

  .details-body {
    margin-top: 7px;
    padding: 9px 12px;
    background: var(--qr-candidate-background, #141926);
    border: 1px solid var(--qr-candidate-border, rgba(255, 255, 255, 0.09));
    border-radius: var(--qr-candidate-radius, 8px);
  }

  .details-hint,
  .details-note {
    margin: 0 0 8px;
    font-size: 0.76rem;
    line-height: 1.45;
    color: var(--qr-candidate-dim, #a8b3c7);
  }

  .details-note { margin: 8px 0 0; }

  .candidates {
    margin: 0;
    padding: 0;
    list-style: none;
    font-size: 0.76rem;
    line-height: 1.6;
    color: var(--qr-candidate-text, #edf1f8);
  }

  /* The address is what is compared between two probes, so it is set in a font
     where a digit cannot be mistaken for another. */
  .candidate-address {
    font-family: ui-monospace, monospace;
    overflow-wrap: anywhere;
  }

  .candidate-kind { color: var(--qr-candidate-dim, #a8b3c7); }

  .candidate-flag {
    margin-left: 6px;
    padding: 0 6px;
    font-size: 0.68rem;
    border-radius: 999px;
    border: 1px solid currentColor;
  }

  .is-new .candidate-flag { color: var(--qr-candidate-open, #3edc97); }

  .is-gone { color: var(--qr-candidate-faint, #5c677a); }
  .is-gone .candidate-address { text-decoration: line-through; }
  .is-gone .candidate-flag { color: var(--qr-candidate-blocked, #ff6b5b); }

  .details .recheck { margin-top: 9px; }
`

const keyOf = c => `${c.type}|${c.protocol}|${c.address}|${c.port}`

/**
 * Build the block, once. Returns the element plus a `render` that can be called
 * as often as the host repaints.
 *
 * `onRecheck` is optional: a host that cannot measure again - one showing a
 * result somebody else handed it - leaves the button off rather than offering
 * one that does nothing.
 *
 * @param {{ onRecheck?: () => void }} [options]
 */
export function createCandidateList ({ onRecheck } = {}) {
  const details = document.createElement('details')
  const summary = document.createElement('summary')
  const body = document.createElement('div')
  const hint = document.createElement('p')
  const items = document.createElement('ul')
  const note = document.createElement('p')

  details.className = 'details'
  details.hidden = true
  body.className = 'details-body'
  hint.className = 'details-hint'
  items.className = 'candidates'
  note.className = 'details-note'
  note.hidden = true

  body.append(hint, items, note)

  let recheck = null

  if (onRecheck != null) {
    recheck = document.createElement('button')
    recheck.type = 'button'
    recheck.className = 'recheck'
    recheck.addEventListener('click', onRecheck)
    body.append(recheck)
  }

  details.append(summary, body)

  /** What the display is being compared against. Null before a second probe. */
  let baseline = null
  /** What is on screen, so a repaint is not mistaken for a new measurement. */
  let rendered = null

  const row = (candidate, state, strings) => {
    const item = document.createElement('li')
    const kind = document.createElement('span')
    const address = document.createElement('span')

    item.className = state == null ? '' : `is-${state}`
    kind.className = 'candidate-kind'
    kind.textContent = `${resolveText(strings[KIND_KEYS[candidate.type] ?? 'candidateHost'])} · `
    address.className = 'candidate-address'
    address.textContent = candidate.port == null
      ? candidate.address
      : `${candidate.address}:${candidate.port}`

    item.append(kind, address)

    if (state != null) {
      const flag = document.createElement('span')

      flag.className = 'candidate-flag'
      flag.textContent = resolveText(strings[state === 'new' ? 'candidateNew' : 'candidateGone'])
      item.append(flag)
    }

    return item
  }

  return {
    element: details,

    /**
     * @param {Array<object> | null | undefined} candidates
     * @param {Record<string, unknown>} strings
     */
    render (candidates, strings) {
      if (candidates == null) {
        details.hidden = true
        return
      }

      // A repaint is not a measurement. A host repaints whenever its string
      // table is assigned, and advancing the baseline there would wipe the marks
      // off the screen because somebody changed language.
      if (candidates !== rendered) {
        baseline = rendered
      }

      const now = new Set(candidates.map(keyOf))
      const beforeKeys = baseline == null ? null : new Set(baseline.map(keyOf))
      const gone = baseline == null ? [] : baseline.filter(c => !now.has(keyOf(c)))

      summary.textContent = resolveText(strings.details)
      hint.textContent = resolveText(strings.detailsHint)
      if (recheck != null) recheck.textContent = resolveText(strings.recheck)

      items.replaceChildren(
        ...candidates.map(c => row(c, beforeKeys != null && !beforeKeys.has(keyOf(c)) ? 'new' : null, strings)),
        ...gone.map(c => row(c, 'gone', strings))
      )

      if (candidates.length === 0 && gone.length === 0) {
        const empty = document.createElement('li')

        empty.textContent = resolveText(strings.detailsEmpty)
        items.replaceChildren(empty)
      }

      // Only once an mDNS name is on screen. Explaining one nobody has seen is
      // how a panel becomes unreadable.
      const hasMdns = candidates.some(c => c.family === 'mdns')

      note.textContent = hasMdns ? resolveText(strings.candidateMdns) : ''
      note.hidden = !hasMdns

      details.hidden = false
      rendered = candidates
    }
  }
}

// The seam for the text the elements show.
//
// Every element used to hold its wording in module constants, which was
// invisible while the demo was the only consumer: the demo is English. The
// first consumer from outside was not, and there was no way in - see #51.
//
// The shape is decided once here rather than per element, because four elements
// each growing their own idea of "how do I pass labels in" is how two of them
// end up different and neither is the one a reader expects.
//
// Two rules:
//
//   - **Merge, never replace.** A consumer that translates one line keeps the
//     defaults for the rest, so a string added upstream later does not go blank
//     in every app that already passed a table.
//   - **A value may be a function.** Some of this text carries numbers - "Part
//     3 of 6", "Still looking… 12 attempts". Those are declared as functions of
//     their parameters, because word order is not universal and a template with
//     `{n}` in it would fix ours onto everyone.

/**
 * Fold a consumer's partial table over the defaults.
 *
 * `null` and `undefined` fall back rather than blanking the text - clearing a
 * label is almost always a mistake, and an element with an empty row reads as
 * broken rather than as translated.
 *
 * @template {Record<string, unknown>} T
 * @param {T} defaults
 * @param {Partial<T> | null | undefined} override
 * @returns {T}
 */
export function mergeStrings (defaults, override) {
  if (override == null) return { ...defaults }

  /** @type {Record<string, unknown>} */
  const merged = { ...defaults }

  for (const [key, value] of Object.entries(override)) {
    if (value == null) continue
    merged[key] = value
  }

  return /** @type {T} */ (merged)
}

/**
 * Read one entry, calling it when it is a function.
 *
 * Named `resolveText` rather than `text` on purpose: `qr-scanner` already has
 * `let text = await this.#read()` inside its scan loop, and an import called
 * `text` was shadowed by it — putting the call three lines above the
 * declaration into the temporal dead zone. That threw inside the loop and
 * killed the scan, and the only visible symptom was a status line that stopped
 * updating.
 *
 * A consumer that supplies a plain string where a function was expected gets
 * that string verbatim. That is deliberate: a fixed caption is a choice rather
 * than a failure, and throwing here would take a screen down over a caption.
 *
 * @param {unknown} value
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function resolveText (value, params = {}) {
  if (typeof value === 'function') return String(value(params))
  return value == null ? '' : String(value)
}

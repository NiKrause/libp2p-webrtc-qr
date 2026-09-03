/**
 * Which lines of an assembled privacy statement a choice just rewrote.
 *
 * The panel exists to say what *this* configuration means. A switch three
 * inches away rewrites its sentences, and unless somebody had memorised the
 * paragraph they have no way to see which one moved — so the element marks
 * them and the stylesheet flashes them.
 *
 * A pure function, and separate from the element, because the interesting part
 * is the comparison and the element cannot be instantiated in the test runner.
 */

/**
 * @param {string[]} previous the statement as it was last painted
 * @param {string[]} next the statement about to be painted
 * @returns {number[]} indices into `next` that are new to the reader
 */
export function changedClauses (previous, next) {
  // Nothing on the first paint. Everything is new then, and a statement that
  // flashes in full on arrival teaches nobody which line their choice moved —
  // it just makes the dialog shout when it opens.
  if (previous.length === 0) return []

  // Compared as a set, not index by index.
  //
  // Index comparison looks equivalent and is wrong as soon as a statement can
  // *drop* a clause: a consumer whose list is `[a, b, c]` with the relay off
  // and `[a, c']` with it on shifts everything after the removal, and index
  // comparison marks all of it. What a reader means by "this line is new" is
  // that they have not read it before, wherever it now sits.
  //
  // Two clauses with identical text count as one, which is the right answer
  // for a statement — the same sentence twice says nothing twice.
  const seen = new Set(previous)
  const changed = []
  for (let index = 0; index < next.length; index++) {
    if (!seen.has(next[index])) changed.push(index)
  }
  return changed
}

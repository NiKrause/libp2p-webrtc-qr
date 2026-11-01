/**
 * What may leave this device, and what may not.
 *
 * Three stages, and the separation is the whole architecture (#179): measuring
 * is local and always on when somebody asks for it, reviewing is local and is a
 * person's job, and **publishing is the only one that opens a connection** - at
 * the moment somebody presses the button and not a second before.
 *
 * ## An allow-list, unlike the local export
 *
 * `logbook.export()` names what it removes. That is defensible for a file
 * somebody asked for and then looks at: a field added next month rides along,
 * and the person holding the file is the person it is about.
 *
 * This cannot work that way. A published row goes into an append-only log that
 * can neither erase nor correct, and the next field somebody adds to an entry
 * must not reach it by inheriting a default. So the fields that travel are
 * named one by one, and anything not on the list stays here - including fields
 * that do not exist yet.
 *
 * ## What is left out, and why it is not an oversight
 *
 * - **Free text somebody typed.** `place` and `peer` are the most useful
 *   context in the local record and the least publishable: "hotel lobby" is a
 *   venue type worth having, "at Anna's flat" names a person, and nothing can
 *   tell them apart. A structured venue field would let that information travel
 *   later; free text never can, because the log cannot take it back.
 * - **`reason` is kept**, and it is the exception that proves the rule: it is
 *   written by the browser, not by a person.
 * - **The exact time.** Rounded to the hour. A carrier, a country and a
 *   timestamp to the second is a fingerprint; the hour keeps the diurnal
 *   pattern a congestion question needs and drops who was awake at 03:14.
 * - **Everything the local export already drops**: candidate addresses, the
 *   public IP, coordinates, city and region. The city and region are not merely
 *   fine-grained, they are *wrong* - IP geolocation places a device at its
 *   provider's egress.
 * - **The review note**, for the reason the logbook's own entry gives.
 * - **`publishedAt`**, which is bookkeeping about the act of publishing and
 *   says nothing about the measurement.
 */

/**
 * The fields of an entry that travel, named one by one.
 *
 * `review` is on the list although every published row is sound by
 * construction: a row that says so is readable on its own, without the reader
 * having to know the rule that put it there.
 */
const PUBLISHED_FIELDS = [
  'id',
  'pairId',
  'scenario',
  'familyFilter',
  'families',
  'role',
  'carrier',
  'format',
  'frames',
  'engine',
  'version',
  'browser',
  'platform',
  'mobile',
  'provider',
  'country',
  'network',
  'outcome',
  'reason',
  'ms',
  'review'
]

/**
 * And the fields of what the far end said about itself.
 *
 * Its own list, because it is not the same list: the peer exchange carries a
 * region and this does not. One allow-list nested inside another is the point -
 * a structure that travels wholesale is a structure that publishes whatever is
 * added to it.
 */
const REPORTED_FIELDS = ['engine', 'version', 'browser', 'platform', 'provider', 'country']

// The same list in the words the panel shows somebody lives in the catalogues
// under `publish.withheld`, because it is text in two languages. This file is
// what makes it true.

const pick = (source, fields) => {
  if (source == null) return null

  const picked = {}

  for (const field of fields) {
    if (source[field] != null) picked[field] = source[field]
  }

  return picked
}

/** Counts by type and family. The same summary the local export makes. */
function summariseCandidates (candidates) {
  const counts = {}

  for (const { type, address } of candidates ?? []) {
    const key = `${type}.${address?.includes(':') ? 'v6' : 'v4'}`

    counts[key] = (counts[key] ?? 0) + 1
  }

  return counts
}

/** Whole hours, in UTC, so the rounding does not leak a time zone either. */
const toHour = at => `${new Date(at).toISOString().slice(0, 13)}:00:00Z`

/**
 * One row, as it would appear in the published log.
 *
 * Deterministic and pure, so the panel can show somebody exactly what would
 * leave before anything connects - and so a test can assert the absence of a
 * field rather than trusting a comment that says it is absent.
 */
export function projectForPublication (entry) {
  return {
    v: 1,
    ...pick(entry, PUBLISHED_FIELDS),
    at: toHour(entry.at),
    reported: pick(entry.reported, REPORTED_FIELDS),
    candidates: entry.candidates == null ? null : summariseCandidates(entry.candidates)
  }
}

/**
 * The rows that would go, in the order they were recorded.
 *
 * Sound, and not already published. The second half is what stops a second
 * press from writing everything twice into a log that cannot take it back.
 */
export function readyToPublish (entries) {
  return entries.filter(entry => entry.review === 'sound' && entry.publishedAt == null)
}

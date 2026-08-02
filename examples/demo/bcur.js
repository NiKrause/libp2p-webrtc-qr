/**
 * Multi-frame QR codes, for invites that do not fit one scannable code.
 *
 * The problem is not the encoder's capacity, it is the camera's. Measured on
 * the live demo with real STUN candidates, a 1122 character invite becomes a
 * 125-module code; rendered edge to edge on a 320px phone that is 2.29 pixels
 * per module, and a second phone cannot read it. The code already fills the
 * screen, so there is no display headroom left - the only remaining lever is
 * the number of modules, and that means splitting the payload.
 *
 * BC-UR splits it into parts and, once the pure parts are exhausted, keeps
 * emitting fountain-coded combinations of them. The scanner therefore does not
 * have to catch every frame in order, or even catch every frame at all: any
 * sufficient set reconstructs the message. That is what makes an animated code
 * tolerable to scan rather than an exercise in timing.
 */

/**
 * Bytes of payload per fragment. The resulting UR string is roughly 2.8x this,
 * because bytewords spend two characters per byte on top of the part header.
 *
 * Measured against a 1122 character invite, at 320px:
 *
 *   bytes   frames   UR chars   modules   px/module
 *     400        3        801        89        3.13
 *     300        4        613        81        3.42
 *     220        6        423        69        3.95   <-
 *     160        8        329        61        4.41
 *      90       13        223        53        4.98
 *
 * 220 is the point where a module is comfortably larger than the 2.29 pixels
 * that failed in the field, while the sequence still completes in about a
 * second and a half. Below it the codes keep growing but the wait grows faster.
 */
export const MAX_FRAGMENT_BYTES = 220

/**
 * Below this, a single static code stays comfortably scannable - about 3.6
 * pixels per module on a 320px screen - and a single glance beats holding a
 * phone still through a sequence. Above it, animate.
 */
export const STATIC_QR_MAX_LENGTH = 600

/** ~5 frames a second. Faster than this and a phone camera starts missing frames. */
export const FRAME_INTERVAL_MS = 200

/**
 * Loaded on demand, for two reasons. The library and its CBOR dependencies are
 * written for Node and expect `Buffer` on the global object, which has to be
 * there before they are evaluated - a static import would be hoisted above the
 * assignment. And most invites never need it, so it stays out of the main
 * bundle.
 */
let libraryPromise = null

async function library () {
  if (libraryPromise == null) {
    libraryPromise = (async () => {
      const { Buffer } = await import('buffer')

      globalThis.Buffer = globalThis.Buffer ?? Buffer

      const bcur = await import('@ngraveio/bc-ur')

      return { ...bcur, Buffer }
    })()
  }

  return libraryPromise
}

/**
 * Start fetching the library without waiting for it.
 *
 * Called once the peer is up, because the first invite is created seconds
 * later and the import is a couple of hundred kilobytes: without this the QR
 * area sits blank for the length of the download, on exactly the connection
 * that is likely to be slow. Failures are swallowed - whoever actually needs
 * the library will await it and see the error then.
 */
export function preload () {
  library().catch(() => {})
}

/**
 * UR strings are case-insensitive by specification, and uppercase is what makes
 * them worth using here: `UR:BYTES/1-6/LPAD…` is entirely inside the QR
 * alphanumeric character set, which spends 5.5 bits per character instead of
 * the 8 that byte mode costs. The same data in lowercase needs a visibly bigger
 * code.
 */
function forQr (part) {
  return part.toUpperCase()
}

export function looksLikeUrPart (text) {
  return typeof text === 'string' && /^ur:/i.test(text.trim())
}

export function needsAnimation (text) {
  return typeof text === 'string' && text.length > STATIC_QR_MAX_LENGTH
}

/**
 * A cycling source of frames. The first `total` calls return the pure parts;
 * after that the encoder returns fountain-coded combinations, so a scanner that
 * joined late or missed one never has to wait for a particular frame to come
 * round again.
 */
export async function createFrameSource (text, options = {}) {
  const { UR, UREncoder } = await library()
  const maxFragmentBytes = options.maxFragmentBytes ?? MAX_FRAGMENT_BYTES
  const ur = UR.fromBuffer(globalThis.Buffer.from(text, 'utf8'))
  const encoder = new UREncoder(ur, maxFragmentBytes)

  return {
    total: encoder.fragmentsLength,
    next: () => forQr(encoder.nextPart())
  }
}

/**
 * Collects scanned parts until the message is whole.
 *
 * `receive` returns `{ state, received, total }` where state is one of
 * `progress`, `complete` or `ignored`. A part belonging to a different message
 * - the other peer created a fresh invite mid-scan - resets the accumulator and
 * starts over on that one rather than rejecting it, because otherwise the
 * scanner sits at "3 of 6" forever against a sequence it will never complete.
 */
export async function createPartAccumulator () {
  const { URDecoder } = await library()
  let decoder = new URDecoder()

  const progress = () => ({
    received: decoder.receivedPartIndexes().length,
    total: decoder.expectedPartCount() || 0
  })

  return {
    receive (text) {
      const part = text.trim().toLowerCase()

      if (!looksLikeUrPart(part)) {
        return { state: 'ignored', ...progress() }
      }

      let accepted = decoder.receivePart(part)

      if (!accepted || decoder.isError()) {
        decoder = new URDecoder()
        accepted = decoder.receivePart(part)

        if (!accepted) {
          return { state: 'ignored', ...progress() }
        }
      }

      if (decoder.isComplete() && decoder.isSuccess()) {
        const payload = decoder.resultUR().decodeCBOR().toString('utf8')

        decoder = new URDecoder()

        return { state: 'complete', payload, received: 0, total: 0 }
      }

      return { state: 'progress', ...progress() }
    },

    reset () {
      decoder = new URDecoder()
    }
  }
}

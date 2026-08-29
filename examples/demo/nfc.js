/**
 * Reading an invite off an NFC tag - the read half of #152, and only that.
 *
 * Web NFC has no peer-to-peer mode and no card emulation: Android's own P2P API
 * is gone and the Web NFC group closed the request rather than implementing it.
 * A browser reads and writes passive NDEF tags, full stop. So this is not a
 * fourth carrier for the handshake - it is the invite link delivered by touch,
 * which is exactly why it is cheap: the payload it yields goes down the same
 * verification path as a scanned code or a pasted link.
 *
 * Chrome on Android only, feature-detected. Everywhere else the button simply
 * is not there, the way the microphone half behaves without a microphone.
 *
 * ## What a tag is allowed to mean
 *
 * A tag is a pointer, never a proof. NDEF has no authentication and no secrets,
 * and anyone who can hold a reader near a tag can copy its bytes. What arrives
 * here is treated exactly like a pasted string: parsed, signature-checked, and
 * rejected on any mismatch. Nothing is trusted because it came by touch.
 */

/** Whether this browser can read tags at all. */
export function supportsWebNfc () {
  return typeof globalThis.NDEFReader === 'function'
}

/**
 * Text carried by one NDEF record, or null where it carries none.
 *
 * Tags written by this project hold a URL record with the invite link, but a
 * text record with the raw payload is accepted too - `payloadFrom` downstream
 * takes either, and a studio that wrote its tags with another tool should not
 * fail on the difference.
 */
function textOf (record) {
  try {
    if (record.recordType === 'url' || record.recordType === 'absolute-url') {
      return new TextDecoder().decode(record.data)
    }

    if (record.recordType === 'text') {
      // The text record carries its own encoding; the constructor accepts
      // utf-8 and utf-16 alike.
      return new TextDecoder(record.encoding ?? 'utf-8').decode(record.data)
    }
  } catch {
    // A record that cannot be decoded is a record this reader does not carry.
  }

  return null
}

/**
 * Listen for tags until stopped.
 *
 * `scan()` prompts for the "nfc" permission on first use and then keeps
 * delivering readings for as long as the page is visible - the OS suspends the
 * radio for hidden pages and locked screens on its own, so there is no
 * visibility handling here.
 *
 * @param {object} options
 * @param {(text: string) => void} options.onReading The first decodable record of a tag.
 * @param {(error: Error) => void} [options.onError]
 * @returns {Promise<{ stop: () => void }>}
 */
export async function startTagReader ({ onReading, onError = () => {} }) {
  const reader = new globalThis.NDEFReader()
  const abort = new AbortController()

  reader.addEventListener('reading', event => {
    for (const record of event.message.records) {
      const text = textOf(record)

      if (text != null) {
        onReading(text)
        return
      }
    }

    onError(new Error('The tag carries no text or URL record'))
  })

  reader.addEventListener('readingerror', () => {
    onError(new Error('A tag was touched but could not be read'))
  })

  // Throws where NFC is off or the permission is refused - the caller shows
  // that, because a button that silently does nothing reads as broken.
  await reader.scan({ signal: abort.signal })

  return { stop: () => abort.abort() }
}

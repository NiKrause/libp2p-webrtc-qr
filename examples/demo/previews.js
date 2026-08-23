/**
 * Small pictures beside the names, and a big one on demand.
 *
 * A received file arrives as a name, a size and a content address. For a photo
 * that is three facts and none of them is the picture, and the person who just
 * received it has to download it and leave the page to find out what it is.
 *
 * ## The type is read from the bytes, never from the sender
 *
 * The announcement carries a MIME type and this module ignores it. A peer
 * controls the bytes, the name *and* that field, and a blob URL made from it
 * lives on this origin - `text/html` there is somebody else's script with this
 * page's storage in reach. `renderReceivedFile` pins the download to
 * `application/octet-stream` for exactly that reason, and a preview that
 * believed the announcement would hand back what that pinning took away.
 *
 * So the type comes from the leading bytes, and only for formats a browser
 * renders as an image. Anything unrecognised gets no preview, which is the
 * honest outcome: a file this page cannot show is a file it should not pretend
 * to know anything about.
 *
 * **SVG is deliberately not in the list.** It is a text format that can carry
 * script, it has no magic number worth trusting, and `<img>` is not the only
 * place a URL can end up. The cost of leaving it out is that vector images show
 * no thumbnail; the cost of leaving it in is a class of bug this file exists to
 * close.
 */

/**
 * Signatures, in the order they are cheapest to check.
 *
 * `bytes` is the first few dozen bytes of the file. WebP and AVIF are container
 * formats whose marker sits after a length field, so they are matched at an
 * offset rather than at the start.
 */
const IMAGE_SIGNATURES = [
  { type: 'image/png', at: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/jpeg', at: 0, bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/gif', at: 0, bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/bmp', at: 0, bytes: [0x42, 0x4d] },
  // RIFF....WEBP
  { type: 'image/webp', at: 8, bytes: [0x57, 0x45, 0x42, 0x50], also: { at: 0, bytes: [0x52, 0x49, 0x46, 0x46] } },
  // ....ftypavif
  { type: 'image/avif', at: 4, bytes: [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66] }
]

const VIDEO_SIGNATURES = [
  // ....ftyp - mp4 and its relatives. The brand that follows varies more than
  // it is worth enumerating; a browser that cannot play it says so in the
  // element, which is a better answer than a list here that goes stale.
  { type: 'video/mp4', at: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  // EBML, which is Matroska and therefore WebM
  { type: 'video/webm', at: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }
]

function matches (bytes, { at, bytes: signature }) {
  if (bytes.length < at + signature.length) return false

  return signature.every((byte, index) => bytes[at + index] === byte)
}

/**
 * What these bytes actually are, or null for anything not worth showing.
 *
 * @param {Uint8Array} bytes
 * @returns {{ type: string, kind: 'image' | 'video' } | null}
 */
export function sniff (bytes) {
  for (const signature of IMAGE_SIGNATURES) {
    if (matches(bytes, signature) && (signature.also == null || matches(bytes, signature.also))) {
      return { type: signature.type, kind: 'image' }
    }
  }

  for (const signature of VIDEO_SIGNATURES) {
    if (matches(bytes, signature)) return { type: signature.type, kind: 'video' }
  }

  return null
}

/**
 * Object URLs for the previews, one per content address.
 *
 * Keyed by the address rather than by the name: the same bytes received twice
 * are one picture, and a URL per arrival would be a leak that grows with the
 * conversation. They stay alive as long as the list they are in, which is the
 * life of the page - so `release` exists for a consumer that clears the list,
 * and is called nowhere in the demo because the demo never does.
 */
export function previewStore () {
  /** @type {Map<string, { url: string, kind: 'image' | 'video' }>} */
  const urls = new Map()

  return {
    /**
     * @param {string} cid the content address, and the cache key
     * @param {Uint8Array} bytes
     */
    for (cid, bytes) {
      if (urls.has(cid)) return urls.get(cid)

      const sniffed = sniff(bytes)
      if (sniffed == null) return null

      // A second blob, deliberately: the one behind the download link is pinned
      // to `application/octet-stream` so a browser saves it rather than
      // rendering it. This one carries the type this module *measured*, which
      // is the only way an <img> can show it.
      const entry = {
        url: URL.createObjectURL(new Blob([bytes], { type: sniffed.type })),
        kind: sniffed.kind
      }

      urls.set(cid, entry)

      return entry
    },

    /** The entry for an address already seen, or null. */
    get (cid) {
      return urls.get(cid) ?? null
    },

    release () {
      for (const { url } of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }
}

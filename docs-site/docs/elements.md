---
id: elements
title: Elements
sidebar_label: Elements
---

```js
import '@le-space/libp2p-webrtc-qr/elements'
```

Registers six custom elements. All are theme-able through CSS custom properties
and translatable through `strings`.

The classes — `QrInviteElement`, `QrScannerElement`, `QrListenElement`, `QrStatusElement`,
`QrPeersElement`, `QrIntroElement` — are exported for framework wrappers and for registering under
a different tag name; importing the module is enough for normal use.

## `<qr-invite>` — shows a payload as a code

| | |
| --- | --- |
| attributes | `value`, `frame-interval` |
| properties | `value`, `frameInterval`, `strings` |
| event | `render` → `{ frames, modules, characters }` |
| strings | `alt`, `part`, `recovery` |

Above `STATIC_QR_MAX_LENGTH` the payload is split into animated BC-UR frames;
`frames > 1` on the `render` event says it happened. `modules` and `characters`
are what to log when a code will not scan.

## `<qr-scanner>` — camera, scan loop, reassembly

| | |
| --- | --- |
| attribute | `label` |
| properties | `label`, `strings`, `validate`, `isOpen` |
| methods | `open()`, `close()` |
| events | `scan` → `{ text }`, `close`, `error` → `{ error }` |
| strings | `label`, `close`, `unsupported`, `starting`, `looking`, `stillLooking({ attempts })`, `rejected`, `animated({ received, total })`, `animatedUnknown` |

`validate` decides whether a scanned code is the one this screen wants —
returning `{ ok: false, reason }` keeps the camera running with the reason shown.

The element releases the camera on **every** way out, including removal from the
DOM.

## `<qr-listen>` — microphone, decoding, reassembly

| | |
| --- | --- |
| attribute | `label` |
| properties | `label`, `strings`, `validate`, `createReceiver`, `isOpen` |
| methods | `open()`, `close()` |
| events | `payload` → `{ text }`, `close`, `error` → `{ error }` |
| strings | `label`, `close`, `unsupported`, `starting`, `listening`, `quiet`, `progress({ received, total })`, `rejected`, `denied` |

The other half of `<qr-scanner>`, and the same shape: the element owns the
device, the decoding and the reassembly, and `validate` decides whether what it
heard is the payload this screen wants. Returning `{ ok: false, reason }` keeps
the microphone open with the reason shown.

`createReceiver` is handed in rather than imported: the codec would otherwise be
in the elements bundle for every page, including the ones that never open a
microphone, and ggwave's WebAssembly glue names Node's `path` and `fs`, which no
browser bundle resolves. One line at the call site keeps the optional dependency
optional:

```js
import { createAudioReceiver } from '@le-space/libp2p-webrtc-qr'

listen.createReceiver = createAudioReceiver
```

It asks for the microphone with `echoCancellation`, `noiseSuppression` and
`autoGainControl` all **off**. Every one of those is tuned for speech and hostile
to this: suppression is built to remove exactly this kind of steady tone,
cancellation subtracts what the speakers are playing, and gain control smears the
symbol boundaries mid-transmission.

The level meter is not decoration — somebody holding two devices together has no
other way to tell a refused microphone from a quiet room. The microphone is
released on **every** way out, including removal from the DOM.

See [Sound](/audio) for the carrier itself.

## `<qr-status>` — what this network will allow

| | |
| --- | --- |
| attribute | `rows` — any of `browser ipv4 ipv6 camera overall`, default `ipv4 ipv6 overall` |
| properties | `strings`, `rtcConfiguration`, `result` |
| methods | `probe()`, `renderResult(result)` |
| event | `probe` → the result |
| reflected | `blocked`, `off-network-risk="blocked\|unreliable"` |
| strings | `browser`, `ipv4`, `ipv6`, `camera`, `overall`, `open`, `relay`, `symmetric`, `blocked`, `measuring`, `alarm`, `alarmUnreliable` |

Shows a progress bar while measuring, and raises an alarm when the network cannot
reach a peer elsewhere. `renderResult` displays a verdict you measured yourself.

**A verdict is an observation about this browser, not about the network.** See
[Network readiness](network).

## `<qr-peers>` — who is connected

| | |
| --- | --- |
| properties | `peers` — `[{ peerId, state }]`, `count`, `strings` |
| event | `disconnect` → `{ peerId }` |
| strings | `connected`, `connecting`, `disconnected`, `failed`, `closed`, `new`, `disconnect`, `disconnectFrom` |

Asking to disconnect is the host's to carry out; the list changes when the host
says it did.

## Translating everything visible

Every element takes a `strings` object that is **merged** over its defaults, so
replacing three labels does not lose the rest.

```js
import { QR_STATUS_STRINGS } from '@le-space/libp2p-webrtc-qr/elements'

status.strings = { ipv4: 'IPv4', blocked: 'keins', measuring: 'Prüfe Netzwerk…' }
```

Values are strings, or **functions** where a count is involved
(`stillLooking({ attempts })`, `animated({ received, total })`) — the package does
not fix its word order onto a consumer.

Defaults: `QR_INVITE_STRINGS`, `QR_SCANNER_STRINGS`, `QR_LISTEN_STRINGS`,
`QR_STATUS_STRINGS`, `QR_PEERS_STRINGS`. `mergeStrings` and `resolveText` are exported for anyone
building on top.

## QR framing

For building your own invite view instead of using `<qr-invite>`.

| | |
| --- | --- |
| `needsAnimation(text)` | is this over `STATIC_QR_MAX_LENGTH` |
| `createFrameSource(text, options)` | `{ total, next() }` — BC-UR frames |
| `createPartAccumulator()` | `receive(part)` → progress or the whole payload |
| `looksLikeUrPart(text)` | is this one frame of a multi-frame code |
| `preload()` | warm the encoder before the first frame |
| constants | `FRAME_INTERVAL_MS`, `MAX_FRAGMENT_BYTES`, `STATIC_QR_MAX_LENGTH` |

Frames are fountain-coded: they can be read in any order and a missed one costs
nothing.

## Theming

Set CSS custom properties on the element or an ancestor.

```css
qr-status {
  --qr-status-open: #3edc97;
  --qr-status-degraded: #ffc24b;
  --qr-status-blocked: #ff6b5b;
  --qr-status-chip-background: transparent;
  --qr-status-chip-color: inherit;
}
```

Each element documents its own variables at the top of its source. Shadow DOM
means nothing else leaks in or out.

# @le-space/libp2p-webrtc-qr

A libp2p transport that takes a WebRTC session whose SDP was exchanged
out-of-band — typically as a scanned QR code — and upgrades it into a libp2p
connection. No circuit relay, no signaling server.

```bash
pnpm add @le-space/libp2p-webrtc-qr libp2p @multiformats/multiaddr
```

Two entry points:

| import | contains |
| --- | --- |
| `@le-space/libp2p-webrtc-qr` | transport, session, payload codecs |
| `@le-space/libp2p-webrtc-qr/elements` | custom elements, network probe, QR framing |

Deep imports are not supported — if something is not re-exported from one of
these, it is not public API.

---

## Session

`QRSession` owns the handshake state machine.

```js
import { QRSession } from '@le-space/libp2p-webrtc-qr'

const session = new QRSession(node, { rtcConfiguration })

// offering side
const offer = await session.createOffer()
const { peerId, connection, address, ageSeconds } = await session.acceptAnswer(reply)

// answering side
const answer = await session.acceptOffer(offer)
session.addEventListener('connect', e => e.detail.peerId)
```

`acceptOffer` returns as soon as the answer is signed — the offering peer cannot
finish until it reads that answer. The connection completes afterwards and
reports itself through `connect`, or `error` if it never does.

### Options

| option | default | meaning |
| --- | --- | --- |
| `rtcConfiguration` | — | passed to `RTCPeerConnection` |
| `compact` | `false` | produce v3 short codes (see below) |
| `iceGatheringTimeout` | 5000 | stop waiting for candidates |
| `connectionTimeout` | 30000 | give up on `connected` |
| `answerWaitTimeout` | — | how long the answering side holds its side open |
| `dialAttempts`, `dialRetryDelay`, `dialSettleDelay` | — | retry shape while the peer attaches its muxer |

Per call: `createOffer({ compact })`, `acceptAnswer(text, { dial })`.
Pass `dial: false` when you open your own protocol stream — otherwise the
connection is dialled twice.

### Methods and events

| | |
| --- | --- |
| `createOffer`, `acceptOffer`, `acceptAnswer` | the handshake |
| `dial`, `dialProtocol` | after it |
| `session.offers` | pending offers, keyed by session id |
| `session.inbound` | connections built from an accepted offer |
| events | `connect`, `error` |

`describeIce(peerConnection)` returns a one-line summary of both candidate sets
and the ICE state — what a failure message should carry.

---

## Staying alive while somebody leaves

Sending an invite through a messenger means leaving the app, and a browser
closes an `RTCPeerConnection` when it suspends the page — on Android within a
couple of seconds, without firing an event. The carrier that is easiest to use
is the one the platform breaks.

A page that is playing audio is not one Chromium freezes. `createKeepAlive()`
does that and nothing else:

```js
import { createKeepAlive } from '@le-space/libp2p-webrtc-qr'

const keepAlive = createKeepAlive({
  track: '/audio/waiting.mp3',
  metadata: { title: 'Waiting for the other phone', artist: 'Simple-Todo' }
})

// From the click that produces the invite — `AudioContext` starts suspended
// under the autoplay policy, and there is no gesture left once the user has
// already gone.
await keepAlive.start()

// The moment the connection is up, or the attempt is abandoned.
await keepAlive.stop()
```

| option | meaning |
| --- | --- |
| `track` | URL of an audio file to loop. Without one it runs near-silent. |
| `silent` | Run inaudibly even with a `track`. |
| `volume` | `0..1`, applied to `track`. Default `0.35`. |
| `metadata` | Shown in the platform's media notification. |

`start()` resolves to whether audio is playing; `running` and `supported` say
where it stands. Both are safe to call twice.

**Audible is the default on purpose.** Silence is the failure mode: a stream the
browser decides is inaudible stops counting as playback, and the page is frozen
anyway with the battery already spent. Audio the user can hear also says the app
is still holding the line through a wait that is otherwise a minute of nothing —
and Android's media notification, once `metadata` is set, is a labelled one-tap
way back into the app, which is the half of the problem nothing else addresses.

Even near-silent, the buffer is not zeros. A buffer of silence is precisely what
a browser may treat as "nothing is playing", so it carries one least-significant
bit instead: inaudible, and not silence to a level meter.

**This is not a wake lock.** A wake lock holds the screen, not the page, and the
browser drops it the moment the page is hidden. The two cover different halves.

> Verified as mechanism, not as cure: the tests assert the audio graph is built,
> resumed and released. Whether it keeps a peer connection alive through a real
> app switch is a claim about Android that only two phones and a messenger can
> settle.

## Payload formats

Two wire formats. **Reading both is unconditional; producing v3 is a choice.**

| | v2 (default) | v3 compact |
| --- | --- | --- |
| prefix | deflate + base64url | `q3:` |
| carries | the whole SDP | fingerprint + packed candidates |
| ICE credentials | transmitted | derived from the fingerprint (HKDF) |
| size, measured | ~1011 chars | ~276 chars |
| signature | yes | yes |

v3 is off by default: a connection built from a reconstructed SDP has gone silent
under load often enough that it is opt-in. Turn it on per offer with
`{ compact: true }`.

An **answer follows the format of the offer it replies to**, never the answering
peer's preference — a peer that sent v2 cannot read a v3 answer.

```js
import { parsePayload, decodePayload, isCompactPayload } from '@le-space/libp2p-webrtc-qr'

parsePayload(text)                 // route only — verifies nothing
decodePayload(text, expectedType)  // verifies, both formats
isCompactPayload(text)             // is this q3:
```

Payloads carry a signed `notBefore`/`notAfter` window, ten minutes by default
(`DEFAULT_LIFETIME_MS`), with `CLOCK_SKEW_MS` of slack.

### Codec functions

| | |
| --- | --- |
| `encodeSignedPayload`, `decodeSignedPayload` | v2, signed and verified |
| `encodeCompactPayload`, `decodeCompactPayload` | v3, signed and verified |
| `compress`, `decompress` | the deflate layer v2 uses |
| `QR_TYPE_OFFER`, `QR_TYPE_ANSWER` | payload kinds |
| `PAYLOAD_VERSION`, `COMPACT_VERSION`, `COMPACT_PREFIX` | format identifiers |

Detail: [`docs/compact-payload.md`](../../docs/compact-payload.md).

---

## Transport

```js
import { webRTCQR } from '@le-space/libp2p-webrtc-qr'

createLibp2p({
  transports: [webRTCQR({ getOutboundSession: peerId => sessions.get(peerId) })]
})
```

`createWebRTCUpgradeContext(components, peerConnection, address, { direction })`
builds the context for a connection you negotiated yourself.

### Why encryption is skipped

The payload is signed with the peer's libp2p key, and the SDP inside it carries
the DTLS fingerprint — so a valid signature binds the WebRTC session to the Peer
ID, the same idea as `certhash` in WebRTC-Direct. DTLS still encrypts. Noise is
skipped because it would only *authenticate*, and the signature already did.

When that stops holding: [`docs/connection-security.md`](../../docs/connection-security.md).

---

## Surviving an app switch

Four parts of one problem: whether a pending invite is still there when somebody
comes back from a messenger. See [`docs/`](https://nikrause.github.io/libp2p-webrtc-qr/mobile)
for why this is the constraint that shapes the rest.

| | |
| --- | --- |
| `leavingSuspendsUs()` | does leaving suspend this page - the gate for showing a hurry-back warning at all |
| `BROWSERS_THAT_HOLD` | browsers observed to hold a waiting invite ~10s. Read this list, do not copy it |
| `createKeepAlive(options)` | keep the page playing audio so it is not suspended. `start()` needs a gesture |
| `createWakeLock()` | keep the *screen* awake. `sync(active)`, and `supported` / `wanted` / `held` |
| `stateOf(peerConnection)` | one word for what a connection is doing, `signalingState` first |
| `pendingConnections(session)` | every connection a session owns - both `offers` and `inbound` |

`createKeepAlive` and `createWakeLock` are not interchangeable: one holds the
page through an app switch, the other holds the screen while the page is
visible. A consumer usually wants both.

`stateOf` reads `signalingState` first because a connection the browser closed
under a suspended page reports `closed` there while `connectionState` can still
say something reassuring - and browsers have shipped versions that closed it
without firing any event ([w3c/webrtc-pc#2489](https://github.com/w3c/webrtc-pc/issues/2489)).
So it is read, never awaited.

`wanted` and `held` are reported separately because only the first is yours to
get right: a headless browser exposes the wake-lock API and then refuses every
request, having no screen to keep awake.

---

## Elements

```js
import '@le-space/libp2p-webrtc-qr/elements'
```

Registers four custom elements. All are theme-able through CSS custom properties
and translatable through `strings`.

The classes — `QrInviteElement`, `QrScannerElement`, `QrStatusElement`,
`QrPeersElement`, `QrIntroElement` — are exported for framework wrappers and for
registering under a different tag name; importing the module is enough for
normal use.

### `<qr-invite>` — shows a payload as a code

| | |
| --- | --- |
| attributes | `value`, `frame-interval` |
| properties | `value`, `frameInterval`, `strings` |
| event | `render` → `{ frames, modules, characters }` |
| strings | `alt`, `part`, `recovery` |

Above `STATIC_QR_MAX_LENGTH` the payload is split into animated BC-UR frames;
`frames > 1` on the `render` event says it happened. `modules` and `characters`
are what to log when a code will not scan.

### `<qr-scanner>` — camera, scan loop, reassembly

| | |
| --- | --- |
| attribute | `label` |
| properties | `label`, `strings`, `validate`, `isOpen` |
| methods | `open()`, `close()` |
| events | `scan` → `{ text }`, `close`, `error` → `{ error }` |
| strings | `label`, `close`, `unsupported`, `starting`, `looking`, `stillLooking({ attempts })`, `rejected`, `animated({ received, total })`, `animatedUnknown` |

`validate` decides whether a scanned code is the one this screen wants —
returning `{ ok: false, reason }` keeps the camera running with the reason shown.
The element releases the camera on every way out, including removal from the DOM.

### `<qr-status>` — what this network will allow

| | |
| --- | --- |
| attribute | `rows` — any of `browser ipv4 ipv6 camera overall`, default `ipv4 ipv6 overall` |
| properties | `strings`, `rtcConfiguration`, `result` |
| methods | `probe()`, `renderResult(result)` |
| event | `probe` → the result |
| reflected | `blocked`, `off-network-risk="blocked\|unreliable"` |
| strings | `browser`, `ipv4`, `ipv6`, `camera`, `overall`, `open`, `relay`, `symmetric`, `blocked`, `measuring`, `alarm`, `alarmUnreliable` |

Shows a progress bar while measuring, and raises an alarm when the network
cannot reach a peer elsewhere. `renderResult` displays a verdict you measured
yourself.

**A verdict is an observation about this browser, not about the network.** The
same phone on the same Wi-Fi can report IPv6 as usable in one browser and absent
in another.

### `<qr-intro>` — explain it before asking anyone to use it

| | |
| --- | --- |
| attribute | `technical` — show the caveats list |
| properties | `strings`, `technical`, `isOpen`, `result`, `rtcConfiguration`, `relay`, `relayOptIn` |
| methods | `open()` → the measured result, `close()` |
| events | `check` → the result, `relay-check` → what the relay check found, `relay-opt-in` → `{ optIn }`, `close` → `{ remember }` |
| slots | default — the app's own story; `header` — beside the title; `advice` — under the verdict; `footer` — beside "do not show again"; `relay` — prose next to the relay choice |
| parts | `dont-show`, `relay-opt-in` — reach a checkbox by its part, never by `input[type=checkbox]`: with a relay configured there are two |
| strings | `title`, `close`, `checkHeading`, `checking`, `ok`, `unreliable`, `none`, `sameNetwork`, `technicalHeading`, `technical` (an array), `dontShow`, `waysHeading`, `wayQr`, `relayLabel`, `relayHint`, `relayChecking`, `relayReachable`, `relayDiscovered`, `relayNone` |

Two halves. The **story** is yours and arrives through the slot — what your app
is for, who the other person is. The **caveats** are the library's: whether a
phone holds a waiting invite, whether Chrome on Android reports IPv6, what a VPN
does. Every consumer needs those and would otherwise write them from memory.

Between them sits a live verdict from `probeNetwork()`, measured on first
`open()` rather than on page load, so nobody spends STUN round trips on a dialog
they never see. `sameNetwork` sits *next to* the verdict rather than inside it:
telling two phones already on one Wi-Fi to find another network would be wrong.

`createIntroPolicy({ storageKey })` decides when to show it:
`shouldOpen({ arrivedViaInvite })`, `remember()`, `forget()`. Three rules worth
knowing — somebody who **arrived by invite never sees it** (they came to accept
something, and suppressing does not mark it seen), **blocked storage shows it**
(seen twice beats never seen), and `forget()` exists because dismissing must not
be a one-way door.

**Room for your own chrome.** An app's introduction is usually not only the
library's: a language switch beside the title, an explicit Close button, a
verdict that needs a link in it. `header`, `footer` and `advice` are where
those go, and they stay empty for anyone who does not fill them.

`advice` sits directly under the verdict, because advice is only worth giving
when it applies and it applies to the line above it. It exists because the
string tables deliberately cannot hold markup — they are read with
`resolveText` and written to `textContent`, and an interpolation habit there is
the one that later gets pointed at a user-supplied string. Advice that needs a
link is markup you write.

**The second way in.** A scanned code needs the other person to be here. When
they are not, the way in is a relay — and this element offers it as a choice
rather than as a fact. Assign `relay` and a checkbox appears, **off**, with the
consequence written next to it; leave it unassigned and the element is exactly
what it was before.

```js
intro.relay = {
  check: () => findReachableRelays({ baked, probe, discover }),
  storageKey: 'myapp.relayOptIn'
}
```

Ticking it checks **at once** — an opt-in whose effect only appears at the next
connection attempt leaves the person guessing, which is the state it replaces.
A remembered yes is checked on `open()`, not on assignment, so the first
outbound call of a session happens while somebody is looking at the answer.
Nothing here dials anything: `check` is yours, because only your app knows its
addresses and its ping. Omit `storageKey` and the choice lasts the session —
storing under a key the library invented would put its namespace in your origin.

### `<qr-peers>` — who is connected

| | |
| --- | --- |
| property | `peers` — `[{ peerId, state }]`, `count`, `strings` |
| event | `disconnect` → `{ peerId }` |
| strings | `connected`, `connecting`, `disconnected`, `failed`, `closed`, `new`, `disconnect`, `disconnectFrom` |

Asking to disconnect is the host's to carry out; the list changes when the host
says it did.

---

## Translating everything visible

Every element takes a `strings` object that is **merged** over its defaults, so
replacing three labels does not lose the rest.

```js
import { QR_STATUS_STRINGS } from '@le-space/libp2p-webrtc-qr/elements'

status.strings = { ipv4: 'IPv4', blocked: 'keins', measuring: 'Prüfe Netzwerk…' }
```

Values are strings, or functions where a count is involved
(`stillLooking({ attempts })`, `animated({ received, total })`) — the package
does not fix its word order onto a consumer. `mergeStrings` and `resolveText` are
exported for anyone building on top.

Defaults: `QR_INVITE_STRINGS`, `QR_SCANNER_STRINGS`, `QR_STATUS_STRINGS`,
`QR_PEERS_STRINGS`, `QR_INTRO_STRINGS`.

**German ships with the package**: `QR_INVITE_STRINGS_DE`,
`QR_SCANNER_STRINGS_DE`, `QR_STATUS_STRINGS_DE`, `QR_PEERS_STRINGS_DE`,
`QR_INTRO_STRINGS_DE`. Two
consumers were translating the same three dozen labels by hand from the same
defaults, which is the same work twice and two chances to fall behind when a
string is added here.

```js
status.strings = QR_STATUS_STRINGS_DE                      // all of it
status.strings = { ...QR_STATUS_STRINGS_DE, blocked: '—' } // with your own voice
```

They are defaults for a locale, not a finished translation of your app: merge
your own wording over them and keep the rest.

---

## Network judgements

Usable without any DOM — and reachable from the **package root**, so deciding
something does not cost you a renderer:

```js
import { probeNetwork, summariseNetwork, offNetworkRisk } from '@le-space/libp2p-webrtc-qr'
```

They stay exported from `/elements` too, for consumers already importing that.

| | returns |
| --- | --- |
| `probeNetwork(rtcConfiguration)` | `{ ipv4, ipv6, overall }`, each `{ state, text }` |
| `summariseNetwork(ipv4, ipv6)` | the combined verdict |
| `offNetworkRisk(result)` | `'blocked'` \| `'unreliable'` \| `null` |
| `offNetworkBlocked(result)` | narrow: `blocked` only |
| `isGlobalUnicastV6(address)` | is this address routable |
| `probeBrowser()` | `{ state, text }` — whether this browser has WebRTC and can open a data channel at all |
| `probeCamera()` | `{ state, text }` — camera availability, read from the Permissions API without prompting |

States: `open`, `relay`, `symmetric`, `blocked`.
`offNetworkRisk` is the one to gate a connect control on — `unreliable` is the
carrier-NAT-without-IPv6 case a phone on mobile data shows, which `blocked`
misses.

`DEFAULT_RTC_CONFIGURATION` asks four STUN servers, two of them over IPv6
literals: a reflexive candidate exists only for a family a STUN transaction
actually used.

### Which relay to try first

```js
import { findReachableRelays, readRelayOptIn, writeRelayOptIn } from '@le-space/libp2p-webrtc-qr'
```

| | |
| --- | --- |
| `findReachableRelays({ baked, probe, discover })` | `{ source: 'baked' \| 'aleph' \| 'none', addresses, askedAleph }` |
| `readRelayOptIn(storage, key)` | a remembered choice, `false` when there is none |
| `writeRelayOptIn(storage, key, value)` | whether it was actually stored |

The rule, not the mechanism: `probe` and `discover` are yours, so this knows
nothing about libp2p or any directory. Baked-in addresses are tried **before**
discovery, which is not only about speed — it means your app contacts a
directory exactly when the addresses it shipped with have gone quiet, and never
in a room where the known relay is up. What discovery returns is probed too: a
registration outlives the machine it describes, so *discovered* is not *alive*.

---

## QR framing

For building your own invite view.

| | |
| --- | --- |
| `needsAnimation(text)` | is this over `STATIC_QR_MAX_LENGTH` |
| `createFrameSource(text, options)` | `{ total, next() }` — BC-UR frames |
| `createPartAccumulator()` | `receive(part)` → progress or the whole payload |
| `looksLikeUrPart(text)` | is this one frame of a multi-frame code |
| `preload()` | warm the encoder before the first frame |
| constants | `FRAME_INTERVAL_MS`, `MAX_FRAGMENT_BYTES`, `STATIC_QR_MAX_LENGTH` |

---

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

---

## Vendored upstream code

`src/vendor/` holds a trimmed copy of `@libp2p/webrtc` internals that are not
exported upstream. See its README for what was changed and why; removing it is
tracked in issue #7.

## License

Apache-2.0 OR MIT

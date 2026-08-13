# Roadmap

Where this project is heading, and why. Ordered by what would change the most
for someone using it, not by how hard it is.

Nothing here is scheduled. It is a record of the open questions, so the next
person - including future us - does not have to rediscover them.

Each item has an issue: this file holds the reasoning, the issues hold the work.
Start at [the roadmap label](https://github.com/NiKrause/libp2p-webrtc-qr/labels/roadmap)
if you are looking for something to pick up.

Items marked **Done** stay here rather than being deleted. What was tried and why
it was ordered that way is the part that is expensive to rediscover - and in more
than one case below, doing the work changed the reasoning that led to it.

---

## 0. Carry the handshake inside a photograph

**Tracked in [#69](https://github.com/NiKrause/libp2p-webrtc-qr/issues/69).**

**The idea:** instead of pressing *Create invite link*, you hand the app a
photo. It gives one back that looks the same, with the offer hidden in it, and
you send that through the chat you were going to use anyway. The other person
feeds it to their copy, gets a photo back carrying the answer, and sends that.
Then you are connected, and the chat contains two holiday snaps.

The technique is [J-UNIWARD](https://systemslibrarian.github.io/crypto-lab-j-uniward/):
JPEG steganography that modifies DCT coefficients, guided by a Daubechies-8
wavelet cost function so the changes land in textured regions where they are
hardest to detect, encoded with syndrome-trellis codes. Both sides need a
**shared key**; the cover image is not needed to extract.

### Why it is worth writing down even before it is worth building

Everything else in this roadmap makes the handshake smaller, faster or more
legible. This changes what the handshake *looks like* to whoever is carrying it.
A QR code and a `#i=…` link both announce themselves as machinery. A photograph
does not, and there are networks where that is the difference between a
handshake and no handshake.

It also fits the shape this project already has. The payload is small - the
compact format measures **276 characters**, and at the lab's default 0.10
bits per non-zero AC coefficient an ordinary phone photo carries several
kilobytes - and the signature that authenticates it is unchanged, because the
steganography is a transport, not a security layer.

### What has to be true

- **The channel must not recompress.** Sent as a *photo*, Telegram re-encodes
  the JPEG and every DCT coefficient with it; sent as a *file*, the bytes
  survive. That single distinction decides whether this works at all, and it is
  a thing a person has to get right in another app.
- **The key has to come from somewhere.** Alice and Bob have no shared secret -
  that is what the handshake is for. A password spoken aloud is a second channel
  the rest of this project does not require.
- **It is slower than a link, and #65 says the connection has seconds.** An
  upload, a download and a re-upload through a messenger is not a two-second
  round trip on a phone. This may only be usable at all from an installed app,
  or with a signalling relay behind it.

See the issue for what would need measuring first.

---

## 1. Adopt QWBP-style compact payloads

**Tracked in [#6](https://github.com/NiKrause/libp2p-webrtc-qr/issues/6).**

**Done**, as the combination this section argued for rather than as adoption.
A v3 codec packs the fingerprint and candidates binary, derives the ICE
credentials from the fingerprint with HKDF instead of sending them, and rebuilds
the SDP locally - while keeping the signature that makes `skipEncryption: true`
sound. Measured against a live deployment: **276 characters compact against 1011
full**. The format is a per-invite choice, and an answer follows the format of
the offer it replies to, because a peer that sent v2 cannot read a v3 answer.

**Today:** the signed offer is around **1057 characters** with STUN candidates
(933 host-only), against a 2200 budget. The whole SDP is transported, deflated
and base64url-encoded. Every ICE candidate makes it longer.

**The idea:** [QWBP](https://magarcia.github.io/qwbp/) - the QR-WebRTC Bootstrap
Protocol by Miguel García, described in
[_Air-gapped WebRTC: breaking the QR limit_](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)
and specified [here](https://magarcia.github.io/qwbp/spec.html) - gets the same
handshake down to **41-100 bytes**. A 97.8% reduction, by refusing to send the
SDP at all:

- a 2-byte header, the raw 32-byte SHA-256 DTLS fingerprint, and ICE candidates
  binary-packed at 7-19 bytes each
- ICE credentials are **derived** from the fingerprint with HKDF-SHA256 rather
  than transmitted - the ufrag and password are computed on both sides
- the SDP is then reconstructed locally from those parts

### Why this matters more than it first appears

The obvious win is a smaller QR code: QWBP fits in a **version 4-5 symbol**
(33×33 to 37×37 modules) where ours is dense and large. That is not cosmetic. A
sparse code scans from further away, at worse angles, in worse light, off
smaller and dimmer screens, with older phone cameras. The single biggest source
of friction in this project is a scan that will not catch, and payload size is
the direct cause.

The less obvious win is that it **dissolves the size ceiling instead of working
around it**. QWBP is two-layer: the QR carries only bootstrap credentials, and
once the encrypted DataChannel is open, the peers exchange whatever they like
over it - the article notes full audio/video SDPs of 6 KB+. Applied here, a
peer with a long candidate list, IPv4 and IPv6 at once, or a TURN server would
no longer be a problem to be encoded; it would be an exchange that happens
_after_ the connection exists.

That makes this a **more attractive path than item 2**, which only makes large
payloads scannable rather than making them unnecessary.

### What we would have to keep

QWBP carries **no identity binding of its own**. This project's entire security
argument is that the SDP - and therefore the DTLS fingerprint inside it - is
signed with the peer's libp2p key, which is what makes `skipEncryption: true`
sound. A QWBP payload that we simply adopted would drop that.

The interesting design is therefore the _combination_: QWBP's binary packing for
the connection parameters, plus a signature over those packed bytes and the
Peer ID. The Peer ID has to travel anyway (38-42 bytes for Ed25519), and an
Ed25519 signature is 64 bytes, so a signed QWBP-style payload lands somewhere
around 150-200 bytes - still an order of magnitude below where we are now.

Open questions: whether to define this as a QWBP profile or a separate payload
version; whether the signature covers the packed binary or a canonical
reconstruction; and how a peer signals which format it speaks.

---

## 2. Multi-frame QR with BC-UR

**Tracked in [#12](https://github.com/NiKrause/libp2p-webrtc-qr/issues/12).**

**Done.** Above 600 characters the invite is split into
[BC-UR](https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-005-ur.md)
fragments of 220 bytes and cycled at 5fps; below that it stays a single static
code. Measured on a 320px phone:

|            | modules | px/module |
| ---------- | ------- | --------- |
| one code   | 125     | 2.29      |
| six frames | 69      | **3.95**  |

**This was promoted above item 1, against the ordering argued here.** The
reasoning was that shrinking the payload removes the problem while animating only
makes it survivable - but the numbers do not support it. Even a 40% reduction
leaves roughly 670 characters, about 2.9 px per module, still marginal for
phone-to-phone. Item 1 alone would not have fixed the case that was actually
failing in the field.

Two things learned in the doing:

- **The frames are uppercased**, which keeps them inside the QR alphanumeric
  character set - 5.5 bits per character against the 8 that byte mode costs. That
  is most of why splitting pays off as well as it does.
- **Fountain frames after the pure parts**, so a scanner that joined late never
  waits for one particular frame to come round again.

[`Le-Space/qrcode-scanner-svelte`](https://github.com/Le-Space/qrcode-scanner-svelte)
was listed here as implementing both sides. It is **scanner-only** and needs
Svelte 5 as a peer dependency, so the underlying `@ngraveio/bc-ur` is used
directly and both sides are implemented here. The pointer was still what led to
the right library.

---

## 3. Remove the vendored `@libp2p/webrtc` subtree

**Tracked in [#7](https://github.com/NiKrause/libp2p-webrtc-qr/issues/7).**

`packages/webrtc-qr/src/vendor` copies **698 lines** from
`@libp2p/webrtc@6.0.28` because that package declares only `"."` in its
`exports` map. A deep import fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` in Node
and in every bundler that honours the map, and shipping a package that requires
consumers to add a bundler alias would be a broken contract.

The fix is upstream: a public subpath export for the DataChannel muxer. An issue
against `js-libp2p` making that case is worth filing - several projects want to
drive WebRTC signaling out-of-band (QR, Bluetooth, audio) and all of them need
this same piece.

There is precedent that this works. Up to libp2p 2 we also had to copy
`maconn.js` and its `util.js` dependency. libp2p 3 made their base class,
`AbstractMultiaddrConnection`, a public export of `@libp2p/utils` - and the copy
became [40 lines of our own](packages/webrtc-qr/src/maconn.js) on a supported
API. The muxer is the same story waiting to happen.

Until then, `pnpm vendor:sync` re-copies the subtree and
[the vendor README](packages/webrtc-qr/src/vendor/README.md) records the exact
upstream version.

---

## 4. Move the session orchestration into the package

**Tracked in [#8](https://github.com/NiKrause/libp2p-webrtc-qr/issues/8).**

**Done.** `QRSession` owns the state machine, and the demo is a consumer of it
like any other application. Item 13 below is what forced the issue: the same
orchestration had been written a third time, in a different repository.

The package currently ships the transport and the signaling codec. The state
machine that drives them - create offer, gather ICE, wait for `connected`,
upgrade in the right direction, retry the dial while the peer attaches its muxer

- lives in the examples, and by now **both** examples implement it separately.

That duplication is the signal. It is also where the subtle bugs were: upgrading
before the connection was up, the wrong `direction`, dialing into the gap before
the answering peer attached its muxer. Every consumer of this package will hit
all three, and none of them are obvious.

Since this was written it has happened a third time, outside this repository:
Yogasūcī re-derived the same state machine and the same three bugs without
knowing this item existed. That is the argument for item 13, and it makes this
item a prerequisite rather than a cleanup.

A `QRSignalingSession` that owns the peer connection lifecycle and emits events
would make the package usable without reading an example first. The work is
mostly separating that logic from the DOM and status-message glue it is
currently tangled with.

---

## 5. Add a replay window

**Tracked in [#9](https://github.com/NiKrause/libp2p-webrtc-qr/issues/9).**

**Done.** Payloads carry a signed `notBefore`/`notAfter` pair, ten minutes by
default, with two minutes of clock skew tolerated so two devices that have
never spoken do not reject each other.

The window sits **inside** the canonical form. Outside it, an attacker replaying
an old payload would simply rewrite the dates before passing it on; inside, that
rewrite invalidates the signature - and the tests assert exactly that, reporting
it as forgery rather than as expiry.

This changed the wire format, so `PAYLOAD_VERSION` is 2 and the package is
0.2.0. Accepting version 1 alongside it was rejected deliberately: an attacker
would just downgrade, which is the same as having no window at all.

Item 8 can now proceed - it was waiting on this, because signaling that travels
over the wire loses the human eye as its freshness guarantee.

---

## 6. Firefox and WebKit in CI

**Tracked in [#10](https://github.com/NiKrause/libp2p-webrtc-qr/issues/10).**

**Done, with one honest gap.** All three engines now run on every push.

This took two corrections. The three projects were not running three engines
at all: a leftover `browserName: 'chromium'` in the shared `use` block
overrode every project, so all three launched Chromium wearing borrowed
user-agent strings. And once the real engines started, Firefox could not
launch in the container until `HOME` was set - an error that had never
appeared, because Firefox had never actually run.

The gap: Playwright's **WebKit build for Linux has no working WebRTC**, so CI
runs every WebKit spec that does not need a peer connection and skips the twelve
that do. WebKit end to end is verified locally on macOS, where the build is
closer to real Safari. Chromium and Firefox are verified end to end in CI.

**A macOS runner was tried, and does not close it.** On `macos-latest` the
eleven signaling specs plus three that pass fine on Linux all failed, and the
suite took 10.6 minutes against 1.9 locally. The three extra failures are the
tell: they have nothing to do with connecting, but they all wait for an invite to
be created. ICE gathering does not complete on that runner - every invite burns
the full 15 second cap - and the SDP it eventually produces carries mDNS `.local`
candidates that nothing in the sandbox resolves. WebKit registers host candidates
under mDNS names and, unlike Chromium, does not appear to fall back to a real
local address when that goes nowhere.

So **neither hosted platform can verify a Safari-family connection**: Linux has
no WebRTC, hosted macOS has WebRTC without usable host candidates. What covers it
is running the suite on a real Mac. The only thing that would genuinely close it
is a self-hosted macOS runner, which is standing infrastructure rather than a
patch.

Otherwise nothing broke. `CompressionStream`, `RTCPeerConnection` and negotiated data
channels behave the same in Firefox and WebKit as in Chromium, and the signed
handshake, the chat protocol and the bitswap file transfer all pass unchanged.

Two things the run clarified. `BarcodeDetector` is exposed by **none** of the
three Playwright builds, including Chromium - so the `jsQR` fallback is the
only path CI ever takes, and the native detector remains untested regardless of
how many engines are added. And more importantly, **the camera path itself is
still untested everywhere**: every automated test exchanges payloads by
copy/paste or programmatically, so `getUserMedia` and live scanning are only
ever verified by hand. More browsers did not close that gap, because it is not
a browser-coverage gap.

---

## 7. TURN, and being honest about NAT

**Tracked in [#11](https://github.com/NiKrause/libp2p-webrtc-qr/issues/11).**

**Done**, and the honesty half turned out to matter more than the TURN half. A
TURN server can be supplied per session, and a failure now says *which* failure
it was: both sides behind a symmetric NAT is a different sentence from an invite
that went stale, and telling someone to hurry when no invite of any age would
have crossed their network is worse than saying nothing. Symmetry is decided per
address family - more than one public port within one family - because a peer
with IPv4 and IPv6 has two ports for ordinary reasons.

There is no TURN server, so two peers behind restrictive or symmetric NATs can
still fail to connect after a perfectly good scan - which is a confusing
experience, because the QR part visibly worked.

Two separable pieces: allowing a TURN server to be configured at all, and
detecting the failure early enough to say _why_ it failed rather than timing out.

**Both are done.** `?turn=` configures a server per visit, and starting the peer
runs a STUN probe that reports IPv4 and IPv6 on separate indicators with a
summary that is green when either family is usable.

**IPv6 turned out to be the substance of it.** Carrier-grade NAT is an IPv4
problem; two peers that both have a global IPv6 address face no translation at
all, only a stateful firewall that ICE opens by itself. That is the one way out
of the laptop-to-mobile case that needs no infrastructure whatsoever, and the
check said nothing about it.

Three corrections came out of building it:

- **The old single indicator was wrong.** Every engine masks the base behind a
  reflexive candidate as `raddr 0.0.0.0 rport 0`, so `relatedPort` is always `0`
  and never `null`. Keying by it put IPv4 and IPv6 in one bucket, whose ports of
  course differ, and an ordinary cone NAT was reported as symmetric.
- **STUN had to be asked over IPv6 literals too.** A reflexive candidate exists
  only for a family a STUN transaction actually used, so a machine with working
  IPv6 was gathering no IPv6 candidate at all when the resolver returned A but no
  AAAA. That was a connectivity bug wearing a display bug's clothes.
- **It made the QR denser.** More candidates means a larger SDP: the live invite
  went from 933 to 1122 characters, about 20%. IPv6 reach and QR legibility pull
  against each other, which is part of why item 2 moved up.

What stays open is the decentralised alternative to TURN - item 10.

---

---

## 8. Multi-peer sessions and mesh bootstrapping

**Tracked in [#14](https://github.com/NiKrause/libp2p-webrtc-qr/issues/14).**

By impact this belongs near the top - it unlocks every group use case at once -
but it is blocked on item 5, so it sits here. The numbering is order of
approach, not of value.

A browser peer holds exactly one QR session today, so three or more devices
cannot form a network. The limitation is in the demo rather than the package:
the transport's `getOutboundSession(remotePeerId)` is already a lookup by peer
id, while `examples/demo/index.js` keeps a single `currentOfferSession` and
closes the previous peer connection whenever a new offer is created.

A full mesh is the wrong target. Every link costs two scans, because the answer
has to be scanned back, so the human cost grows quadratically - three devices
need six scans, five need twenty, eight need fifty-six.

The approach is to let **QR bootstrap and the wire complete**. Once one libp2p
connection exists, no camera is needed: `@libp2p/webrtc`'s private-to-private
transport already exchanges SDP over an existing libp2p stream. If A-B and A-C
were scanned, B and C can signal _through A_ and form a direct link without
anyone lifting a phone. That is item 1's two-layer idea generalised to a group,
and it brings the cost down to n-1 links by camera.

Two consequences are worth stating up front. The **security property survives**:
a relaying peer cannot substitute the SDP it forwards, because the signature
binds it to the originator's Peer ID and would have to be forged. But a relaying
peer **can replay a stale payload** - while scanning, the human eye was the
freshness guarantee, and over the wire that disappears. That is why item 5 is a
prerequisite here rather than a refinement.

**Done**, and it works as described: scanning is needed only for the first
connection. Two peers that have both reached a third learn about each other over
the existing links, exchange their signed payloads through it, and connect
directly. Messages carry their sender, and the lower Peer ID initiates so two
peers do not dial each other at once.

---

## 9. Surviving standby

**Tracked in [#33](https://github.com/NiKrause/libp2p-webrtc-qr/issues/33).**

Found in the field: three devices connected, one phone went into standby, and its
connection was gone with no way back except a fresh invite and another scan.

It is two different failures. If the page survived the sleep, the peer connection
object is still there and `restartIce()` would resume it **keeping the data
channels** - but an ICE restart is a new offer/answer, and offer/answer is
signalling. If the page was discarded, there is nothing to restart, and the peer
comes back with a new key: not merely disconnected but unrecognisable.

**The first two steps are done.** A screen wake lock is held while a connection is
live and the page is visible, which covers a phone dozing off on its own. And the
node's key survives a reload, so a discarded-and-restored tab comes back as the
same peer.

That key lives in `sessionStorage`, and the scope is the design rather than a
detail: `localStorage` would make every tab of the browser the same peer, and a
peer refusing to dial itself would have quietly broken the two-tab handoff this
demo depends on. Written that way first, it failed the second-tab test on all
three engines.

**Done**, all four steps. A peer that kept any live connection renegotiates the
dead one through it with no scanning, trying its routes in turn because the peer
it picked may not be connected to the one it is trying to reach. When no route
home is left, the page offers a single **Reconnect** button instead of a walk
back through the setup.

`restartIce()` was the proposal and is not what shipped. It renegotiates while
keeping the data channels, which sounds exactly right - but by the time ICE
reports `failed` the libp2p connection on top is already torn down, muxer and
streams with it. Nothing left to keep.

Persisting the Peer ID exposed two bugs that could not happen while every
reconnect brought a fresh identity, and both cost a debugging round:

- libp2p still held the dead connection under the _same_ peer id, so the new dial
  died with `Remote closed connection during opening`
- **`offerSessions` was never pruned**, and `getOutboundSession` returned the
  first match - which after a reconnect is the stale, closed session. It now
  returns the newest, and dead sessions are dropped with their connection

The limit worth stating: everyone disconnecting at once still needs a rendezvous
both sides can reach afterwards. That is item 10's problem, and a property of
having no signalling server rather than a bug.

---

## 10. Decentralised alternatives to TURN

**Tracked in [#23](https://github.com/NiKrause/libp2p-webrtc-qr/issues/23).**

A relay is infrastructure, and the premise here is a connection that needs none.
The question is whether the existing libp2p network can stand in.

**AutoNAT cannot.** Its own documentation says it does not implement hole
punching; it only reports whether addresses a node listens on are dialable, and a
browser never has one. **DCUtR cannot either** - it coordinates simultaneous-open
for TCP and QUIC, while a browser's hole punching _is_ ICE, which is what already
failed.

**Circuit relay v2 can, with limits worth knowing.** The js-libp2p defaults are
2 minutes and 128 KiB per circuit, deliberately, because a circuit is meant as a
coordination channel and not a data path. Raising them means operating the relay,
which reintroduces a known server. The honest framing is that circuit relay
differs from TURN in addressing, not in topology.

And any relay fallback must run a normal Noise handshake: `skipEncryption` is
sound here _only_ because the signature binds the DTLS fingerprint, and a circuit
carries no DTLS.

The part no protocol removes: two peers, both behind symmetric NAT, nobody else
present - somebody has to forward the bytes.

---

## 11. A public dataset of where direct WebRTC works

**Tracked in [#27](https://github.com/NiKrause/libp2p-webrtc-qr/issues/27).**

Draft, and the open questions are still open. Whether this project's premise
holds is a property of the network, and there is no published data on where it
does - not per country, per carrier or per venue type. The idea is to let people
who run the network check contribute the result.

The constraints shape the schema rather than decorate it: an append-only
replicated log can neither erase nor correct, so a record that cannot single
anyone out is the only design that works. Closed value lists, no free text, month
granularity. Decentralisation multiplies controllership rather than dissolving it.

Worth settling early: the argument to operators should be about **IPv6, not NAT**.
A symmetric NAT is a rational response to IPv4 scarcity and a hotel cannot fix it
without buying address space. Missing IPv6 is a real, fixable deficiency.

## 12. Put the camera and the code in modals, and show one thing at a time

**Tracked in [#36](https://github.com/NiKrause/libp2p-webrtc-qr/issues/36).**

**By impact this belongs at the top.** Every other open item makes the protocol
better; this one decides whether someone who does not know what a peer id is can
get two phones talking. The numbering is order of approach, not of value - the
same caveat item 8 carries.

The connect step shows everything at once and asks the user to work out which
half applies to them. It opens by saying so in words - _"You only ever do **one**
of the two boxes below"_ - which is a fair description of the problem and not a
solution to it.

Two lanes are visible from the start. Below both sits a third area holding the
camera, the stop button and the scan status, so pressing **Scan their code**
starts a video further down the page, on a phone often below the fold. The
generated code appears in a fourth place, stacked with a link field, two buttons,
a freshness line and the frame counter.

Nothing there is broken. It is laid out for someone who already knows the
protocol.

**Done.** A camera modal carrying the status line that already reports
`Animated code: 3 of 6 parts`, and a code modal for the invite, each closing
itself once it has served its purpose. The card underneath shows two buttons
instead of two lanes, and pasting a link - the fallback for a link that did not
open the page by itself - sits behind a disclosure.

Native `<dialog>` and `showModal()` rather than anything hand-rolled: the focus
trap, Escape, the inert background and focus returning to whatever opened the
dialog all come with it. Only releasing the camera is left to do by hand, and it
hangs off the dialog's `close` event, so every way out - ×, Escape, the stop
button, or the app closing it after a successful scan - goes through one path.

**The inert background turned out to be the design.** With an invite on screen
everything behind the modal is unreachable, so *both* ways of receiving a reply
had to move inside it - scanning and pasting alike. A button behind the modal is
a button that does not exist. That was not in the plan above; the suite found it,
by failing to reach the paste field the moment the modal existed.

The synthetic camera added for this is worth noting separately: Chromium and
Firefox now run with a fake capture device, so the scan modal is driven end to
end - opened, closed by three different routes, and checked for having released
the track each time. **That is the first time any test has exercised the camera
path at all**, and it makes a dent in the gap recorded under item 6.

Already in place beforehand: the setup cards fold away once a connection is up
and unfold if it drops.

---

## 13. Ship the connect experience, not just the protocol

**Tracked in [#38](https://github.com/NiKrause/libp2p-webrtc-qr/issues/38).**

**Done.** The connect flow ships as custom elements - the scanner owns the
camera and its release, the invite owns the code and its animation, the status
panel owns the readiness rows - with a seam for translating every label, because
the first consumer outside this repository needed the strings in another
language before it needed anything else.

Item 4 says the session orchestration is implemented twice and that the
duplication is the signal. It is worse than that now, and the evidence arrived
from outside this repository.

[Yogasūcī](https://github.com/Le-Space/yogasuci) is a third implementation. It
re-derived, independently, the same three failure modes item 4 lists: waiting for
`connected` before upgrading, the right `direction`, and retrying the dial while
the answering peer attaches its muxer. It has its own `DIAL_ATTEMPTS` loop with
its own retry delay, arrived at the same way — by hitting the bug.

Then it happened again, in the same week, one layer up. The demo hands a reply to
the tab that owns the offer over a `BroadcastChannel`, because clicking a reply
link in a messenger opens a new tab that holds no peer connection. Yogasūcī now
has that too, written from scratch, down to the same decision not to use
`localStorage` because a persisted value replays an old handshake. Neither knew
about the other.

Twice is a coincidence in the small and a design statement in the large: **the
part people need is not the transport, it is the connect step.** What this
package ships is the half that was never the hard part.

### What the demo already has that a consumer will otherwise rebuild

Not hypothetical — each of these exists here and is missing there:

- **BC-UR multi-frame codes** (item 2). Yogasūcī has a hard 2200-character budget
  and falls back to copy & paste above it, which it documents as a limitation.
  That limitation is already solved in this repository.
- **The status LEDs at connection start.** Yogasūcī has an open issue asking for
  exactly this and would build it a second time.
- **Mesh reconnection after a drop** (item 8). Yogasūcī reconnects by scanning
  again.
- **Surviving standby and a peer id across reload** (item 9).

### What makes this hard, and the recommendation

The demo is vanilla DOM. Yogasūcī is Svelte 5 with a hard rule that colours and
type come only from its own brand tokens. Anything reusable across both has to be
framework-neutral without taking the styling hostage.

**Custom elements with shadow DOM, themed through CSS custom properties.** The
consumer passes its brand in; the element owns structure, focus handling, camera
lifecycle and the animation of a multi-frame code. Custom properties cross the
shadow boundary, which is what makes this work at all — and shadow DOM is what
keeps a consumer's global stylesheet from reaching in and breaking a modal it did
not write.

The alternative, a headless core with a hand-written view per framework, is more
honest about styling and multiplies the view work by the number of consumers,
which is the thing being fixed.

### Order matters more than usual here

**Item 4 first.** Extracting UI while the orchestration still lives in the view
moves the duplication rather than removing it, and leaves the components carrying
a state machine that belongs underneath them.

Then item 12, which is where the modal shape gets proved on a real screen before
anything is frozen into a published API. Only then extract.

### The second consumer is the test, not a bonus

A component library with one consumer is a refactor. With two it is an interface.

`simple-todo` on a `webrtc-qr` branch is the candidate, and it is a good one
because it is currently the _opposite_ of this project: it reaches its peers
through a relay, with pinning and bootstrap. Making the same app work with a
scanned code and nothing else is the sharpest available question about where the
seams belong — and it is the only way to find out which parts of the demo were
general and which were always about a chat window.

Attempt it _while_ extracting, not after. A second consumer discovered late
confirms the seams; a second consumer discovered early moves them.

---

## 14. Scan a real code through the real camera path

**Tracked in [#41](https://github.com/NiKrause/libp2p-webrtc-qr/issues/41).**

**Done.** The suite renders the app's own animated invite to a video file and
hands it to Chromium as the capture device, so `getUserMedia`, the scan loop,
`jsQR` and BC-UR reassembly all run for real. Chromium only: Firefox's fake
stream is a generated pattern with no way to supply a file, and WebKit has no
fake device at all.

Every field failure in this project has been in the camera path, and no test has
ever gone through it:

- the scanner rejected every QR, because it fed a link to a raw-payload parser
- the code was too dense to read between two phones
- the status line stamped over the part counter during a healthy animated scan

All three were found by a person holding two phones, with the suite green
throughout - because the suite exchanges payloads by copy/paste and programmatic
calls.

Item 12 added a synthetic capture device, so the scan modal is now opened, closed
and checked for releasing its track. That is the plumbing. What it does not cover
is the part that keeps breaking: **the camera never sees a QR code.** Chromium's
fake device produces a rolling test pattern, so `jsQR` is handed frames with
nothing in them to decode.

The work is to feed the camera a video of the code the app itself rendered.
Chromium takes `--use-file-for-fake-video-capture=<file.y4m>`, so the app's own
QR output can be painted into frames, written as y4m at the animation's frame
rate, and scanned by the real loop. Both shapes matter, and the second is the one
that failed in the field: a static code, and an animated BC-UR sequence arriving
at 5fps while the camera samples faster.

Worth simulating rather than idealising: the failure being reproduced is *a code
too small to resolve*, so a test that paints the code across the whole frame at
full resolution proves less than it appears to.

Two honest limits. **Chromium only** - Firefox's fake stream is a generated
pattern with no file input, and WebKit has no fake device at all. And **not the
physical layer**: focus, glare off a screen, moiré between a display's pixel grid
and a camera sensor, and a hand that will not hold still. Those stay with hand
testing, and saying so is part of the item, because a green suite otherwise
implies they were covered.

---

## Not planned

- **Replacing WebRTC.** The point of this project is that libp2p can use a
  connection whose signaling never touched a server. That is a property of the
  handshake, not of the transport underneath.
- **A signaling server as fallback.** Adding one back would remove the only
  reason this exists.

---

## Related work

Reading these first will save time on items 1 and 2:

- [_Air-gapped WebRTC: breaking the QR limit_](https://magarcia.io/air-gapped-webrtc-breaking-the-qr-limit/)
  and the [QWBP specification](https://magarcia.github.io/qwbp/spec.html) by
  Miguel García
- [`AquiGorka/webrtc-qr`](https://github.com/AquiGorka/webrtc-qr) by Gorka
  Ludlow, the sample this project started from
- [`vbocan/webrtc-oob-pairing`](https://github.com/vbocan/webrtc-oob-pairing) by
  Valer Bocan - the same idea studied from the defensive-security side, with
  detection signatures

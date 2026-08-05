# QR WebRTC demo

Browser demo for [`@le-space/libp2p-webrtc-qr`](../../packages/webrtc-qr).
Live at <https://webrtc-qr.le-space.de>.

```bash
pnpm start   # http://localhost:5173
```

There are two ways in, and they end in the same place.

**Send a link.** One person selects **Create invite link** and sends it — one tap
via the system share sheet, straight into whatever messenger they use. The other
person opens the link: the page starts, verifies the invite and produces a reply
link on its own. That reply goes back the same way, and the connection is up.

**Scan a code.** The QR encodes the *invite link*, not the raw payload, so a
phone's own camera app opens the page with everything already loaded. The in-app
scanner is still there for when that is inconvenient.

Nothing needs to be copied out of a text box, and neither side has to know
whether it is "A" or "B" — you either have a link or you do not.

## Why it was rebuilt this way

An earlier version asked people to copy a base64 payload out of a textarea
labelled "QR payload or copy/paste fallback", paste the other person's payload
over their own, and pick the right one of five buttons. Watching someone
unfamiliar attempt it over a messenger produced, in order:

- they could not find the text area at all
- they sent their **Peer ID** twice instead of the payload, because it was the
  prominent, labelled, copyable-looking string on the page
- they gave up on the copy button and selected page text by hand, sending the
  log and the footer along with it
- they had to be told to delete their own payload before pasting
- both sides drifted out of step, and the browser said
  `Called in wrong state: stable`
- 27 minutes passed between invite and reply, by which time the offer was dead,
  and nothing had ever said an invite has a shelf life

Every one of those is addressed above, except the last, which cannot be designed
away — an invite goes stale as its ICE candidates expire. So the page says how
long it stays fresh, marks it when it does not, and offers a new one.

Pasting is handled without a button press, links wrapped by a chat app are
un-wrapped before parsing, and raw WebRTC errors are translated into something
that says what to do next.

### A reply opened in the wrong tab

Only the tab that created an invite holds the pending connection, but tapping a
link in a messenger usually opens a *new* tab, which can never complete the
handshake. That tab hands the reply to the original one over `BroadcastChannel`
and says so; if nothing answers, it explains the situation rather than failing
with a WebRTC state error.

## File transfer

Chat messages are JSON envelopes, so plain text and file announcements share one
stream. A file announcement carries only the CID, name and size - the bytes are
pulled separately by bitswap.

Helia is composed by hand rather than with `createHelia()`, which is
`withBitswap(withLibp2p(withHTTP(...)))`. The `withHTTP` layer would add
trustless gateways and delegated routing, so a dropped file could arrive over
the public internet instead of the connection built by scanning a code. Without
it, bitswap over that one libp2p connection is the only way the bytes can move.

## When it will not connect

Confirmed by hand across several setups:

| Setup | Result |
| --- | --- |
| Two or three browsers on one machine | works - host candidates |
| Phone and laptop on the same wifi | works |
| Laptop on wifi, phone on **mobile data** | **fails** without a TURN server |

The last row is not a bug to fix in code. Mobile carriers put subscribers behind
carrier-grade NAT that is usually symmetric, and a symmetric NAT defeats the
reflexive (`srflx`) candidates that STUN provides - the port the STUN server saw
is not the port used towards a different destination. A failure logs what ICE
had to work with, and a run with no `relay` candidate on either side is this
case:

```
ICE candidates - local: 6 host, 1 srflx; remote: 6 host, 2 srflx; ice: disconnected
```

**IPv6 is the way out that needs no infrastructure.** Carrier-grade NAT is an
IPv4 problem; most mobile networks hand out a globally routable IPv6 address
alongside it. Two peers that both have one connect directly, because there is no
address translation to defeat - only a stateful firewall, which the outbound
half of ICE opens exactly as it would a NAT binding.

A TURN server can be supplied per visit to test the IPv4-only case:

```
?turn=turn:example.org:3478&turnUser=alice&turnPass=secret
```

It is off by default on purpose. A relay is infrastructure, and the point of
this project is a connection that needs none - but it only relays the media.
The signalling still travels between the two people and nowhere else.

## Surviving standby

A phone that sleeps takes its connections with it, and without a signalling
server there is no way to resume them on its own. Two measures, both partial and
both honest about it:

**The screen is kept awake while a connection is live** and the page is visible.
This covers the common case — a phone dozing off because nobody touched it while
the other person was reading. It does nothing when someone deliberately locks
their phone, and it is not claimed to.

**The Peer ID survives a reload.** What is kept in `sessionStorage` is the
private key; the Peer ID is derived from it, which is also why the other side can
verify a signature with nothing but the ID — for Ed25519 the public key is
embedded in it. The scope of that storage is the design:

| | |
| --- | --- |
| reload | same peer |
| browser discards a background tab, then restores it | same peer |
| a second tab | a *different* peer, which can still connect to the first |
| tab closed | gone |

`localStorage` would have made every tab of the browser the same peer, and a peer
that refuses to dial itself would have quietly broken the two-tab handoff this
demo depends on. That is not hypothetical: it is what the second-tab test caught
when this was first written the other way.

Persisting an identifier at all is a trade, so the identity panel shows it, says
where it came from, and offers **Start over as a new peer**.

**A connection that dies comes back by itself, if any route home is left.** The
mesh already carries signed payloads between peers who have never met; a peer who
dropped is just a peer we were talking to a moment ago. Any remaining connection
can carry the renegotiation, routes are tried in turn — the peer you picked may
not be connected to the one you are trying to reach — and nobody scans anything.

`restartIce()` is *not* used, although it is the obvious primitive: it
renegotiates while keeping the data channels, but by the time ICE reports
`failed` the libp2p connection on top has already been torn down, muxer and
streams with it. There is nothing left to keep, and a fresh connection is
indistinguishable from the user's side.

**When no route home exists**, two peers and one connection, there is no third
party to signal through and nothing invents one. The page says so and offers a
single **Reconnect** button rather than sending you back through the setup.

See [#23](https://github.com/NiKrause/libp2p-webrtc-qr/issues/23) for why the
remaining case — everyone disconnected at once — needs a rendezvous.

## Animated codes, and why they are needed

An invite that will not fit one scannable code is split into a BC-UR sequence
and cycled on screen.

The trigger is not the encoder's capacity, it is the camera's. Measured against
the live demo with real STUN candidates, a 1122-character invite becomes a
125-module code; rendered edge to edge on a 320px phone that is **2.29 pixels per
module**, and a second phone cannot read it. The code already fills the screen -
`#qr-image` is `100vw` below 560px - so there is no display headroom left. The
only remaining lever is the number of modules.

Splitting at 220 payload bytes per fragment gives:

| | modules | px/module at 320px |
| --- | --- | --- |
| one code | 125 | 2.29 |
| six frames | 69 | **3.95** |

Two details make it cheaper than it sounds. The frames are **uppercased**, which
keeps them inside the QR alphanumeric character set - 5.5 bits per character
instead of the 8 that byte mode costs, so the same data needs a visibly smaller
code. And once the pure parts are exhausted the encoder emits fountain-coded
combinations, so a scanner that joined late or missed a frame never has to wait
for one particular frame to come round again; any sufficient set reconstructs the
message.

Below 600 characters the invite stays a **single static code**, because one
glance beats holding a phone still through a sequence.

`@ngraveio/bc-ur` is loaded on demand rather than bundled: it adds ~227 kB across
two chunks, and most invites never need it. The main bundle grows by 1.8 kB
gzipped. It is fetched in the background as soon as the peer starts, so the code
is not waiting on a download when the invite is created.

## What the five LEDs mean

Starting the peer runs a throwaway `RTCPeerConnection` against both STUN servers
and reads the candidates per address family:

| LED | Green when |
| --- | --- |
| Browser | `RTCPeerConnection` exists and a negotiated data channel can be opened |
| IPv4 | one reflexive port for the family - the mapping does not change per destination |
| IPv6 | STUN answered from a global unicast address (`2000::/3`) |
| Camera | camera permission is already granted |
| Result | either address family is green |

Either family being usable is enough, so the summary is green if either one is.
Amber means only peers on this same network are reachable.

Which chips appear is the host's choice - `rows="browser ipv4 ipv6 camera
overall"` here, the two families and the summary by default. The two ends of the
row answer questions the middle cannot: a browser with no WebRTC at all fails
before any network question is meaningful, and a scan that never starts is
usually a camera permission rather than anything about connectivity.

The camera chip reads the Permissions API and never calls `getUserMedia`.
Checking by *asking* would raise the permission prompt this chip exists to
report on, and would do it at page load, before anyone pressed Scan. So a
browser that does not expose camera permission state - Safari, today - reports
amber and says the answer is unknown until you try. Amber here is honest
ignorance, not a warning.

The base address behind a reflexive candidate is masked - every engine reports
`raddr 0.0.0.0 rport 0` - so candidates can only be grouped by family. That has
one blind spot: two interfaces in the same family, a VPN next to wifi, have
different base ports and read as symmetric. The check errs pessimistic, and
nothing in the UI is disabled on the strength of it.

### Why two of the STUN servers are IPv6 literals

A reflexive candidate exists only for an address family that a STUN transaction
actually used. The browser reports the address *the server saw*; it does not
enumerate its own interfaces, and the IPv6 host candidate that would give the
game away is hidden behind an mDNS `.local` name like every other host
candidate. So if `stun.l.google.com` resolves to A but not AAAA in the browser's
own resolver - which a private DNS or DoH setting can decide - a machine with
working IPv6 gathers no IPv6 candidate whatsoever.

`stun:[2001:4860:4864:5:8000::1]:19302` and `stun:[2606:4700:49::]:3478` are
therefore configured alongside the hostnames, so an IPv6 transaction happens
regardless of what DNS returns. Measured on an IPv6-capable network, adding them
costs nothing: gathering completes in ~130 ms either way, and the extra
candidates deduplicate against the ones the hostnames produce.

This is not cosmetic. Without a reflexive IPv6 candidate the two peers never
exchange IPv6 addresses, so the one path that beats carrier-grade NAT without
any relay is never even attempted.

## The connect step

Two things happen there, and each gets the screen while it is happening.

**Scanning opens a camera modal** with the status line under it — the same one
that reports `Animated code: 3 of 6 parts`. It closes itself once a code is
accepted, and by Escape or ×.

**An invite opens as a code modal**: the code, the frame counter, and the ways of
receiving a reply. Both of them are in there — *Scan their reply* and *They sent a
link* — because showing an invite means waiting for a reply, and a modal makes
the page behind it inert. A button that is behind the modal is a button that does
not exist.

It closes when the answer arrives, including when a second tab took it.

Native `<dialog>` and `showModal()`, deliberately: the focus trap, Escape, the
inert background and focus returning to whatever opened the dialog all come with
it. Hand-rolled, that is a lot of code to get subtly wrong. What is left to do by
hand is releasing the camera, which happens on the dialog's `close` event so that
every way out — × , Escape, the stop button, or the app closing it after a
successful scan — goes through one path.

Underneath, the card shows two buttons instead of two lanes. Pasting a link is
the fallback for a link that did not open the page by itself, so it sits behind a
disclosure rather than in everyone's way.

The setup cards fold away once a connection is up, and unfold if it drops.

## Network behavior

- WebRTC DTLS encrypts the data channel.
- QR signatures bind the exchanged SDP to the displayed libp2p Peer IDs.
- Public STUN servers are configured for NAT discovery. Append `?ice=host` to
  skip them, which is what the e2e suite does.
- There is no TURN server. Connections can still fail when both peers are behind
  restrictive or symmetric NATs.
- Camera access requires HTTPS or a localhost origin.

## Test

```bash
pnpm test
```

The Playwright suite runs on **Chromium, Firefox and WebKit**. It creates two
real browser libp2p peers, verifies that a
rendered QR image decodes back to the exact signed payload, transfers data in
both directions, moves a file over bitswap and checks the download link hands
back the exact bytes, and rejects modified signed signaling payloads.

## Link previews and the canonical URL

The same build is served from `webrtc-qr.le-space.de` **and** from every IPFS
gateway that resolves the CID. That is genuine duplicate content across a dozen
hosts, so the page declares a canonical pointing at the custom domain.

Open Graph and Twitter image URLs are **absolute** for the same reason: a
crawler that found the page under `/ipfs/<cid>/` resolves a relative asset to a
path that does not exist there, and the preview silently shows nothing.

The card itself is checked in at `public/og-image.png` rather than generated
during the build - a social image should change when someone decides it should,
not as a side effect. Regenerate it with:

```bash
pnpm og-image
```

The QR code on the card is real and resolves to the demo, so it works even when
someone points a phone at a screenshot of it.

## Publish to IPFS

The Vite build uses relative asset URLs and can be published below an IPFS
gateway path:

```bash
pnpm build
ipfs add --recursive --quiet --cid-version=1 dist
```

CI publishes the same build to Aleph IPFS and links it to the custom domain -
see [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml). Prefer
the HTTPS domain over a raw gateway path, because `getUserMedia` needs a secure
origin with its own scope.

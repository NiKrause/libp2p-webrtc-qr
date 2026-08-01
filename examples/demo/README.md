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

A TURN server can be supplied per visit to test it:

```
?turn=turn:example.org:3478&turnUser=alice&turnPass=secret
```

It is off by default on purpose. A relay is infrastructure, and the point of
this project is a connection that needs none - but it only relays the media.
The signalling still travels between the two people and nowhere else.

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

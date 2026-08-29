# What this app knows, and who else learns it

Written by reading the code and then measuring it, because a privacy document
assembled from intentions is a document about intentions. Where a claim below
could be checked in a browser, it was: the storage list comes from asking a real
tab after a real connection, not from a grep.

The short version: **the messages and files never touch a server**, and that is
the point of the project. Everything else on this page is about the metadata that
gets a connection built in the first place, which is a different question and a
less comfortable one.

---

## The thing that cannot be hidden: an invite contains addresses

A WebRTC offer is a list of ways to reach a device. That is what it is *for*. So
the QR code on your screen, and the link you paste into a messenger, contain:

- the addresses your device holds, or `.local` stand-ins where the browser
  substitutes them
- the address the outside world sees you at, when a STUN server answered
- your Peer ID, which is a public key
- the DTLS fingerprint the signature binds to that key

**Whoever sees the code or the link learns those.** A photograph of the screen is
enough. A messenger you paste the link into has it, and so does anyone that
messenger shows it to.

Two things make this less bad than it sounds, and neither makes it nothing. An
invite expires after **ten minutes**, so a code in a photograph is worthless by
the time most people would look at it. And a payload is signed: it can be read by
anyone, but it cannot be altered without the change being detected.

There is no version of out-of-band signalling that avoids this. A connection
needs an address, and the address has to travel.

---

## Who is contacted, and when

| Who | What they learn | When |
|---|---|---|
| **The web server** serving this page | your IP, as any web server does | every visit |
| **STUN servers** — Cloudflare and Google | your IP, from the packet | on every readiness check and every connection attempt |
| **api.ipquery.io** | your IP | **only** when you tick the disclosure box and press *Work out where I am* |
| **Your browser's location provider** | whatever it uses to place you | only if you grant the position permission |
| **openstreetmap.org** | the coordinates, in the URL | only if you follow the map link |
| **The peer you connect to** | your IP, unavoidably; plus browser, system, provider, country and region if your logbook is on | on connection |

**No relay and no signalling server.** This is the claim the project exists to
make and it is literally true: no request goes to either, and the network panel
in the developer tools shows none.

**STUN is not nothing.** The readiness panel and every connection attempt send
UDP to Cloudflare and Google, and the packet carries your address — that is how
a reflexive candidate is discovered at all. It is stated in the intro dialog for
the same reason it is stated here: an honesty half-sentence buys more credibility
than it costs, and a technical reader finds it in seconds anyway.

**The lookup is the only optional third party**, and since it discloses an
address rather than merely observing one, it needs a tick as well as a press. The
box says what the request costs, because a button labelled *work out where I am*
says what it will find and not what it gives away.

---

## What is stored on this device

Measured after a real connection between two tabs, not assumed:

| Where | Key | Written | Holds |
|---|---|---|---|
| sessionStorage | `libp2p-webrtc-qr:identity:v1` | on start | your private key |
| localStorage | same key, **but only when launched as an installed app** | on start | your private key |
| localStorage | `webrtc-qr.locale` | on language switch | `en` or `de` |
| localStorage | `webrtc-qr.simpleView` | on view switch | which view you chose |
| localStorage | `webrtc-qr.introSeen` | only if you tick *do not show again* | that you ticked it |
| localStorage | `webrtc-qr.logbook.enabled.v1` | only if you turn the logbook on | that flag |
| localStorage | `webrtc-qr.logbook.v1` | only while the logbook is on | the entries — see below |
| localStorage | `webrtc-qr.logbook.context.v1` | only while the logbook is on | provider, place, peer, country, region, city, IP, coordinates |
| localStorage | `webrtc-qr.logbook.lookupConsent.v1` | on ticking the disclosure box | that tick |

**No IndexedDB. No cache storage. No service worker.** Verified in a real tab
after a connection: both were empty and no worker was registered. Files that
arrive over bitswap live in memory for the session and are gone when the tab
closes.

**The key is deliberately in *session*Storage in a tab** — close it and you are a
different peer next time. It moves to localStorage only when the app was launched
from a home screen, because there "this tab" stops being a thing a person can
reason about. Neither choice is a security boundary: anything running on this
origin can read either.

---

## The logbook, which is the one that stores something interesting

Off by default. Nothing is written until it is ticked.

It records every connection attempt — the ones that fail as well as the ones that
work, because a log of successes says nothing about what is broken. An entry
holds your browser, engine and system, the format and frame count of the code,
the network verdict, the ICE candidates **including their addresses**, the
outcome, the reason for a failure, and whatever you typed into the three fields
no browser can know.

Three things about it are worth stating plainly:

**Turning it off keeps what is already there.** Deleting somebody's own
measurements because they closed the tap would be its own surprise. *Clear the
log* is the button that means that.

**The export is a projection, not a copy.** Candidate addresses and ports, the
public IP, the coordinates and the city are removed, and the file names what was
removed so a recipient knows they are holding a projection. Country and region
survive, because those are what a public dataset would ask for.

**What a peer is told follows the export's rule.** While the logbook is on, a
peer you connect to receives browser, system, provider, country and region — the
same set the export carries — and sends you the same. Your address, your city and
the notes you typed never travel. One rule for both questions, because two rules
drift, and the drift is always discovered in the direction of having sent too
much.

That last one is a disclosure your switch causes, so it follows *your* switch and
not the other person's: somebody else ticking a box on their phone cannot make
this device describe itself.

---

## What is never stored and never sent

- **Messages and files.** They cross the WebRTC data channel between two devices.
  Nothing here writes them to disk and no server sees them.
- **Anything about you, anywhere else.** There is no analytics, no telemetry, no
  error reporting, no cookie, no account, and no identifier that follows you
  between visits except the one you can throw away by closing the tab.

---

## Where the honest gaps are

**The lookup can be confidently wrong.** It places you by IP, which is a guess
about your provider's routing rather than a fact about you — a connection from
Berlin has been seen reported as Berlin while the browser's own position was in
Bavaria, several hundred kilometres away. That disagreement is now visible
because the coordinates are printed beside the city, and it is worth knowing
before either number is used for anything.

**The coordinates are the sharpest thing on the screen.** They are shown after
you press the button and are gone after a reload, and the export drops them. But
while they are there, they are on screen — worth remembering before a screenshot.

**A tab is not a vault.** Everything in the table above is readable by anything
running on this origin. The protection here is that little is kept and that the
key can be discarded, not that storage is hardened.

**This is experimental software.** Use it where a failed connection is an
inconvenience rather than a loss, and read the README before building on it.

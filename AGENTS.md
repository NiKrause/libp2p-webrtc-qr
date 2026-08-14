# Notes for agents

What this project has learned the hard way, ordered by how badly it hurts to
rediscover it. Read the top three before changing anything in the connect path.

`README.md` explains what the project is; `ROADMAP.md` explains where it is
going. This file is neither: it is the set of facts that are expensive to learn
twice, and the questions worth asking before writing code.

Three things below are in open pull requests rather than on `main` at the time
of writing - `offNetworkRisk` and `test/exports.test.js` in #75, and
`BROWSERS_THAT_HOLD` in #77. They are documented here because the reasoning is
the point and it outlives the branch; if one of them is missing, that is why.

---

## 1. Mobile browsers kill a waiting invite within seconds

The single most consequential fact here, and the reason several features exist.

A browser closes an `RTCPeerConnection` when it suspends the page — see
[w3c/webrtc-pc#2489](https://github.com/w3c/webrtc-pc/issues/2489), where Chrome
did it **without firing any event**. On a phone, switching to a messenger to
paste an invite link is exactly that. Field testing on two Android phones: you
have **a couple of seconds** before the invite is dead. Only DuckDuckGo and
Safari have been seen to hold one for around ten.

Consequences already built on this:

- `leavingSuspendsUs()` in `examples/demo/index.js` — the check is named for
  what matters, not for "is this a phone"
- the `#hurry-back` hint, shown at the tap that sends someone away, because a
  warning on the way *back* is a post-mortem
- the `.pc-health` readout, which records the connection's state on the way out
  and on the way back — nobody can watch a screen that is in the background
- `BROWSERS_THAT_HOLD`, the single place to change when this stops being true

**Ask before you build:** is the feature you are adding making the round trip
longer? Item 0 on the roadmap (a handshake inside a photograph) is behind this
question, not in front of it.

**Do not** assume a wake lock helps: it holds the screen, not the page, and the
browser drops it the moment the page is hidden.

## 2. Never trust one browser's word about the network

The same phone on the same Wi-Fi reports `IPv6: usable` in DuckDuckGo and
Firefox and `IPv6: none` in Chrome as an installed PWA. Whether an IPv6
reflexive candidate appears depends on the browser build and its WebRTC
IP-handling policy as much as on the route.

So: **a readiness verdict is an observation about this browser, not a verdict on
the network.** The wording in `network.js` was corrected once for exactly this —
it used to say "this network offers IPv4 only", which two screenshots disproved.

The judgements live in `packages/webrtc-qr/src/elements/network.js` and are
exported from `./elements`:

| function | answers |
| --- | --- |
| `probeNetwork()` | what this browser can gather, per address family |
| `summariseNetwork()` | can I reach anyone from here |
| `offNetworkRisk()` | `'blocked'` \| `'unreliable'` \| `null` — **use this to gate a connect control** |
| `offNetworkBlocked()` | narrow: `blocked` only |

`unreliable` is the 5G case — carrier NAT on IPv4, no IPv6 — which is far more
common than `blocked` and was silently unwarned until it was reported from a
real device.

**Ask before you build:** does your feature need a *reliable* path off the
network? If so, `offNetworkRisk()` is the gate, and TURN (#11) or a relay (#23)
is the answer, not a retry.

## 3. The barrel is the API

`package.json` exports only `"."` and `"./elements"`. A function that exists in
a module but is not re-exported from the right barrel **cannot be imported by a
consumer at all** — deep imports are not a fallback.

This is not hypothetical: `offNetworkBlocked` shipped, rendered an alarm, was
announced as the way for an application to gate its connect button, and was
absent from `elements/index.js`. `test/exports.test.js` now asserts the surface.

**Ask before you build:** is this meant for yogasūcī or another consumer? Then
export it *and* add it to that test. Note the barrel needs two DOM stubs to be
importable in Node — that is why nothing checked it before.

## 4. Anything visible must be translatable

Every element takes a `strings` property that is **merged** over its defaults, so
a consumer replacing three labels does not lose the rest. See
`elements/strings.js`. `QR_STATUS_STRINGS`, `QR_SCANNER_STRINGS`,
`QR_INVITE_STRINGS`, `QR_PEERS_STRINGS` are all exported.

New user-visible text goes in the strings object, never inline. The first
outside consumer needed the labels in another language before it needed anything
else.

## 5. Tests: what is cheap, what is a trap

- **`?ice=host`** loads the app with no STUN servers, so ICE gathering is
  instant. Use it for anything not about candidate discovery. Forgetting it is
  what turned a 3-minute suite into 12 and made CI red — see the commit "Gather
  host candidates only in the two new specs".
- **The invite link strips its query** (`url.search = ''`), so a test that
  arrives *via a link* has to put `?ice=host` back.
- **`{ iceServers: [] }`** makes the `blocked` verdict deterministic without a
  hostile network.
- **Don't poll for something transient.** Read it synchronously: the probe bar is
  set before the first `await`, so a locator poll can miss it entirely on a fast
  engine. Same for the progress steps — a `MutationObserver` installed via
  `addInitScript` sees every value, a 20ms sampler does not.
- **CI runs one worker with two retries.** A test that needed a retry is reported
  as *flaky*, not passed, so the instability stays visible. A test that needs
  them regularly is a bug report, not a reason to raise the number.
- **The bitswap file-transfer test flakes** in Firefox and WebKit on CI, never
  twice the same way, and passes alone. Check that before blaming your change.

## 6. Deliberate decisions, so they are not undone by reflex

- **No service worker.** Chrome dropped the requirement in 108 (mobile) / 112
  (desktop); caching a libp2p stack is how you ship a version nobody can update.
  Asserted in `installable.spec.js`.
- **Identity: `sessionStorage` in a tab, `localStorage` when installed.** Two
  tabs must be two peers — the whole two-tab flow depends on it — but an
  installed app has no second tab, and a fresh key every launch means nothing can
  recognise you. Reset clears both.
- **Nothing is disabled on a bad verdict.** A symmetric NAT still connects peers
  on the same network, and hiding the controls would block something that works.
- **The answer follows the offer's format**, not the answering peer's
  preference: a peer that sent v2 cannot read a v3 answer.
- **Warnings only where they are true.** A desktop never renders the mobile
  hints at all, so a screen reader cannot find advice that is false there. A
  warning shown everywhere is a warning worth ignoring.

## 7. Things that look like bugs and are not

- **Two windows tinted alike** — browser detection is best-effort;
  `navigator.brave.isBrave()` is the only non-string signal, so Brave is checked
  first. DuckDuckGo *does* name itself on both Android and iOS.
- **`Result: local only` with no alarm** — correct before `offNetworkRisk`
  existed, wrong after. If you see it now, that is a regression.
- **The remote handover workflow** costs Aleph credits per run and provisions a
  fresh VM. It went red once on a different CRN — see #76. One run is not
  evidence either way.

---

## Before you ask for a review, check

1. Does it still work when the page is backgrounded for ten seconds?
2. Does the verdict it shows describe *this browser* or claim something about
   *the network*?
3. Is every new judgement exported from the barrel, and every new string
   translatable?
4. Did you use `?ice=host` where candidate discovery is not the point?
5. If you changed the connect path, did you run the full suite across all three
   engines, and read the whole summary rather than `tail -4`?

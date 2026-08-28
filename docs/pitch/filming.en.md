# Filming and cutting

One plan for both scripts. All of it can be shot with two devices and a tripod, and none
of it needs a multi-track edit.

## Set up before rolling

- **Technical view off.** The pitch shows the simple view; the technical one is for
  developers and makes the frame busy. (For the engineering script, see below.)
- **Short code on** if you are filming the scan. Otherwise it is five animated frames
  rather than one still code, and the camera visibly takes longer. The box sits under
  *Create invite link*.
- **Both devices in the same language** as the script.
- **Logbook off** (the default). It is a developer's instrument and it distracts.
- **Auto-brightness off, both screens bright.** There are two scans to film, and a device
  that dims itself mid-take will fail the second one — which is not the camera's fault
  and will look like it is.

## Shots

| # | sec | picture | sound |
|---|---|---|---|
| 1 | 0–4 | Two phones side by side on a table, both on the start screen | "Two phones. A code on one screen." |
| 2 | 4–9 | Close on device A: a thumb presses **Create invite link**, the code appears | "The other one scans it —" |
| 3 | 9–14 | Device B lifts, camera over the code; B then shows **its own** code | "— and shows a code back." |
| 4 | 14–18 | Device A now scans B's code; cut on the moment the dialog closes | "The first one scans that. Connected." |
| 5 | 18–23 | Screen recording: the link is pasted into a messenger and sent | "Not in the same room? Then both directions go as a link." |
| 6 | 23–30 | Device A presses **Listen for their reply**, device B presses **Play it as sound**; both in frame | the tones play **audibly** — two seconds with no narration |
| 7 | 30–34 | The level meter in the listening dialog moves, then the dialog closes | "The answer comes back as sound." |
| 8 | 34–46 | Both devices: a message is typed and appears on the other; then drag a photo across | "There is nobody in between…" |
| 9 | 46–51 | **Take both devices off the internet**, and the message still goes through | "In the same room, it does not even need the internet." |
| 10 | 51–56 | Still frame: the demo's address | quiet closing line |

Shots 3 and 4 are **one** movement and should be cut as one. There are two scans and both
have to be visible: showing only one quietly claims that something *is* introducing the
two peers — the very thing this project does not do.

Shot 9 is the strongest proof in the video and costs five seconds. It only works if both
devices are on the same local network and the connection was **already up** — flight mode
drops Wi-Fi too, so use a router with no uplink, or turn off mobile data and leave Wi-Fi
on.

## For the engineering script

The same pictures, with two additions:

- On "we deleted it", cut to the **network panel of the developer tools** while the
  connection is being made. There is no request to any signalling service. That is the
  evidence a technical audience wants to see rather than hear.
- On "being honest", show the STUN request in the same panel. Anybody claiming honesty
  should be willing to point at it.

## A detail that is itself an argument

**The code in the video is worthless by the time anybody sees it.** An invite expires
after ten minutes, so you can film a real one with nothing hidden — and that is worth
saying if somebody asks in the comments: pause the video, scan the code, and you get
nothing. That is not the video being careless, it is the system working.

What you should **not** show: the logbook after a location lookup — it holds the public
IP, and now the coordinates and a map link with them — and the *network provider* field if
you filled it in. The coordinates go away on reload, so the simplest fix is to reload the
page before shooting.

## Cutting

- **No music over shot 6.** The sound *is* the demonstration.
- Hard cuts, no dissolves. The subject is immediacy.
- If a shot runs long, take it out of **8**, not 6 or 9. A message arriving is expected;
  the tones and the offline moment are not. Never shorten 3 or 4 — that is the handshake.

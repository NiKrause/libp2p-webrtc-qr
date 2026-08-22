---
id: audio
title: Sound
sidebar_label: Sound
---

A third carrier for the handshake, alongside the code and the link — and the one
that fixes an asymmetry the other two cannot.

## Why sound at all

The handshake is symmetric and the hardware is not. Two phones are fine: each has
a camera and a screen, so each can show a code and read one. **A laptop and a
phone are not.** The laptop shows the offer, the phone scans it — and then the
phone has to hold its answer up to a webcam that is badly angled, poor, or
missing. In practice people fall back to copy and paste, which is the case this
project exists to make effortless.

So: QR in one direction, sound in the other. The idea comes from
[vbocan/webrtc-oob-pairing](https://github.com/vbocan/webrtc-oob-pairing), which
pairs a workstation with a phone that answers over an audible chirp.

**Carrier, not format.** These are the same signed bytes that go into a code or a
link, and the signature inside the payload is what authenticates it — here as
everywhere else. A microphone is not a trusted channel and is not treated as one.

## What it costs

Measured at 48 kHz, for one full transmission of 140 bytes:

| protocol | seconds | bytes/s |
| --- | ---: | ---: |
| `normal` | 13.5 | 10.3 |
| `fast` | 9.3 | 15.1 |
| `fastest` | 5.0 | 28.0 |

A compact (v3) answer is around **207 bytes**, so two transmissions: about **8
seconds** on `fastest`, **14** on `fast`. A full (v2) answer is around 758 bytes —
six transmissions, thirty seconds at best — which is why this carrier wants the
compact format rather than the invite's own.

`fast` is the default. The difference to `fastest` is five seconds against a room:
the fastest protocol packs its symbols closest together, which is also what makes
it the first to fail against an echo or a fan.

## The limit that does not announce itself

The codec carries **at most 140 bytes per transmission and silently truncates
anything longer** — a valid waveform that decodes cleanly to the first 140 bytes,
with the loss reported only on stdout. A half-answer that verifies as a
half-answer is the worst outcome this carrier has, so payloads are framed and
chunked here, and a frame that would reach the limit throws instead.

The frame header is `<index><total>:` — one digit each, so at most nine
transmissions, which is past anything this project produces.
`AUDIO_TRANSMISSION_LIMIT`, `AUDIO_HEADER_LENGTH` and `AUDIO_CHUNK_LIMIT` are
exported because a consumer sizing its own payload should read the number rather
than copy it.

## Sending

```js
import { encodeToAudio } from '@le-space/libp2p-webrtc-qr'

const context = new AudioContext()
const { frames, seconds } = await encodeToAudio(answerPayload, {
  protocol: 'fast',           // AUDIO_PROTOCOLS: normal, fast, fastest
  sampleRate: context.sampleRate,
  volume: 15
})

for (const samples of frames) {
  const buffer = context.createBuffer(1, samples.length, context.sampleRate)
  buffer.copyToChannel(samples, 0)
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  await new Promise(resolve => { source.onended = resolve })
}
```

One buffer per transmission rather than one for all of them. The gap between them
is where a receiver that missed a chunk hears the next preamble cleanly, and
where a person gets to move the phone closer without losing what already arrived.

`AUDIO_DEFAULT_PROTOCOL` is what `protocol` falls back to.

## Listening

```js
import { createAudioReceiver } from '@le-space/libp2p-webrtc-qr'

const receiver = await createAudioReceiver({ sampleRate: context.sampleRate })

// Feed it blocks of microphone samples — from an AudioWorklet, a
// ScriptProcessor, or a recorded buffer. It answers null until a payload is
// whole.
const payload = receiver.push(samples)
if (payload != null) {
  receiver.close()
  await session.acceptAnswer(payload)
}
```

Chunks may arrive in any order and more than once — somebody playing the sound
again because the first attempt was drowned out is the ordinary case, not an
error — so a repeat is ignored rather than restarting anything. `missing()`
returns the transmissions still outstanding, which is what a "2 of 3" readout is
made from. `reset()` forgets a half-received payload; `close()` releases the
codec.

## The dependency

The codec is [ggwave](https://github.com/ggerganov/ggwave) (MIT), an **optional
peer dependency** loaded with `await import()` at the moment somebody opens the
channel. Nobody who only wants the transport pays 150 KB of WebAssembly for a
feature they never open, and nobody's build fails because a package they do not
use is missing. Reaching the channel without it throws an error that names the
package and says every other carrier still works.

`loadAudioCodec()` is that load, exported for a consumer who wants to warm it
before a gesture. `resetAudioCodec()` forgets it again, which is for tests.
`frameForAudio()` and `parseAudioFrame()` are the framing on its own, for anyone
carrying these payloads over a different sound library.

## What is not proven

The round trip is tested as a loopback: the waveform this package produces, fed
back into its own receiver. That proves the framing, the chunking and the
reassembly. **It does not prove a room.** A laptop speaker into a phone
microphone at conversational distance, with an echo and a fan, is a measurement
and it is hand work — see
[#3](https://github.com/NiKrause/libp2p-webrtc-qr/issues/3).

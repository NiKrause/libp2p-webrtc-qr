# For engineers — English

*Spoken script, about 55 seconds. Aimed equally at web2, web3 and crypto audiences.*

---

Every WebRTC application needs a signalling server.
Something has to introduce two peers to each other.

**We deleted it.**

What it would have done, the two of you do yourselves — in both directions.
Offer out, answer back. Two legs, two scans.

Both travel across the table as a QR code.
Or as a link, through any messenger you like.
Or — when the other side has no camera worth using — **back as audible sound.**

The channel is interchangeable, because the trust is not in the channel.
The payload is signed with the libp2p key that binds the DTLS fingerprint to the peer
ID. That is exactly why the Noise handshake can be skipped.

No relay. No TURN. No account.

Being honest: STUN sees your IP, and the page itself comes from a web server.

And where hole punching fails, it is almost never the code's fault.
It is IPv4 scarcity. With IPv6 at both ends, the detour disappears.

Open source, Apache and MIT.

---

## What each line is carrying

- **"We deleted it"** is the hook. Anybody who has built on WebRTC stops here — the
  signalling server is the piece you cannot get rid of.
- **Both directions are mandatory, not fine print.** Anybody who has built on WebRTC
  sees a video with a single scan and knows at once: the answer is missing, so something
  *is* introducing the peers. The second scan is the evidence that the server is really
  gone — and it is also the leg that fails in practice, which is what justifies the
  acoustic return channel.
- **The three carriers are not a list, they are the proof.** Code, link and sound carry
  the same signed payload; that they can be swapped freely *demonstrates* that the
  security does not hang on the channel. That is why the sentence about the signature
  comes immediately after them rather than before.
- **The signature is not a feature, it is the argument.** It is *why* skipping the
  handshake is sound. Leave it out and the claim sounds like "we turned encryption off".
- **The honesty line buys credibility rather than costing it.** Without it the first
  expert comment takes the video apart, and deservedly.
- **Do not blame network operators.** Symmetric NAT is the rational answer to IPv4
  scarcity, not negligence, and Wi-Fi client isolation is a deliberate security measure.
  Missing IPv6 is the fixable deficiency — the strong version of the argument, and the
  only one that survives a technical audience.
- **No relay, meant literally.** This demo calls none. The library offers consumers a
  seam for one, for the case where hole punching fails.

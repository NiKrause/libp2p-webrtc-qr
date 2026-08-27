# For engineers — English

*Spoken script, about 55 seconds. Aimed equally at web2, web3 and crypto audiences.*

---

Every WebRTC application needs a signalling server.
Something has to introduce two peers to each other.

**We deleted it.**

The offer and the answer travel across the table as a QR code.
Signed with the libp2p key that binds the DTLS fingerprint to the peer ID — and that is
exactly why the Noise handshake can be skipped. The code *is* the trust anchor.

No relay. No TURN. No account. No registration.

Being honest: STUN sees your IP, and the page itself comes from a web server.

And where hole punching fails, it is almost never the code's fault.
It is IPv4 scarcity. With IPv6 at both ends, the detour disappears.

Open source, Apache and MIT.

---

## What each line is carrying

- **"We deleted it"** is the hook. Anybody who has built on WebRTC stops here — the
  signalling server is the piece you cannot get rid of.
- **The signature is not a feature, it is the argument.** It is *why* skipping the
  handshake is sound, not a security bullet point beside it. Leave it out and the claim
  sounds like "we turned encryption off".
- **The honesty line buys credibility rather than costing it.** Without it the first
  expert comment takes the video apart, and deservedly.
- **Do not blame network operators.** Symmetric NAT is the rational answer to IPv4
  scarcity, not negligence, and Wi-Fi client isolation is a deliberate security measure.
  Missing IPv6 is the fixable deficiency — the strong version of the argument, and the
  only one that survives a technical audience.
- **No relay, meant literally.** This demo calls none. The library offers consumers a
  seam for one, for the case where hole punching fails.

# Helia over QR WebRTC

Two Helia (IPFS) nodes transfer a file over a libp2p connection that was
negotiated entirely out-of-band, by scanning or pasting signed QR payloads. No
relay, no signaling server, no bootstrap list, no gateway.

```bash
pnpm start   # http://localhost:5173
```

Open two browsers, create an offer in one, paste it into the other, paste the
answer back. Then add a file on one side and fetch its CID on the other.

## Why the Helia setup looks unusual

```js
helia = withBitswap(withLibp2p(createHeliaLight(), node))
await helia.start()
```

`createHelia()` is `withBitswap(withLibp2p(withHTTP(createHeliaLight())))`. The
`withHTTP` layer adds trustless gateways and a delegated routing endpoint, so
the default configuration fetches blocks **over the public internet**. A file
transfer would then succeed while proving nothing about the peer-to-peer
connection - the demo would be a lie.

Dropping `withHTTP` leaves bitswap over libp2p as the only way to obtain a
block, and the QR peer as the only peer to obtain it from. That is what makes
the passing test meaningful.

Two details that are easy to get wrong:

- `withLibp2p` takes the node as its **second argument**. Passing it as
  `createHeliaLight({ libp2p })` leaves Helia building its own libp2p instead.
- `createHeliaLight()` returns a node that has **not started**. The mixins only
  attach their brokers while the node is starting, so `start()` has to be called
  explicitly - without it there are no block brokers at all.

## Test

```bash
pnpm test
```

Two Playwright specs:

1. Two browser Helia nodes complete the QR handshake, one adds a file, the other
   fetches it by CID and gets the exact bytes back.
2. Fetching a CID nobody has fails, rather than quietly resolving. This is the
   guard against the HTTP fallback creeping back in - with gateways configured
   this test would pass for the wrong reason.

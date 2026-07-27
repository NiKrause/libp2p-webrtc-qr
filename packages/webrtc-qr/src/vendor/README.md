# Vendored `@libp2p/webrtc` internals

These files are a verbatim copy of the compiled internals of
[`@libp2p/webrtc`](https://github.com/libp2p/js-libp2p/tree/main/packages/transport-webrtc),
licensed Apache-2.0 OR MIT. They are **not** original work of this repository.

| File | Upstream path |
| --- | --- |
| `maconn.js` | `dist/src/maconn.js` |
| `muxer.js` | `dist/src/muxer.js` |
| `stream.js` | `dist/src/stream.js` |
| `util.js` | `dist/src/util.js` |
| `constants.js` | `dist/src/constants.js` |
| `pb-message.js` | `dist/src/private-to-public/pb/message.js` |

**Vendored from `@libp2p/webrtc@5.2.24`.**

Only two edits were applied: the `./private-to-public/pb/message.js` import was
rewritten to `./pb-message.js`, and trailing `sourceMappingURL` comments were
removed.

## Why this copy exists

`WebRTCMultiaddrConnection` and `DataChannelMuxerFactory` are exactly the
building blocks this transport needs, but `@libp2p/webrtc` declares only `"."`
in its `exports` map:

```
ERR_PACKAGE_PATH_NOT_EXPORTED
Package subpath './internal/maconn' is not defined by "exports"
```

A deep import therefore fails in Node and in every bundler that honours the
exports map. Shipping a package that requires each consumer to add a bundler
alias would be a broken contract, so the subtree is vendored instead.

## Removing this copy

Upstream issue to track: expose these building blocks as public subpath
exports. Once `@libp2p/webrtc` exports them, delete this directory and change
`../transport.js` back to importing from the package.

Because both peers of a QR session run this same code, the vendored muxer only
ever talks to itself - it does not need to stay wire-compatible with the
upstream WebRTC transport. Re-vendoring is still worthwhile for bug fixes:
re-copy the table above from the newer release and re-run the demo e2e suite.

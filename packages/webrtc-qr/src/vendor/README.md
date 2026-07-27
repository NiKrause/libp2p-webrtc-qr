# Vendored `@libp2p/webrtc` internals

These files are a verbatim copy of the compiled internals of
[`@libp2p/webrtc`](https://github.com/libp2p/js-libp2p/tree/main/packages/transport-webrtc),
licensed Apache-2.0 OR MIT. They are **not** original work of this repository.

| File | Upstream path |
| --- | --- |
| `muxer.js` | `dist/src/muxer.js` |
| `stream.js` | `dist/src/stream.js` |
| `constants.js` | `dist/src/constants.js` |
| `pb-message.js` | `dist/src/private-to-public/pb/message.js` |

**Vendored from `@libp2p/webrtc@6.0.28`.**

Only two edits were applied: the `./private-to-public/pb/message.js` import was
rewritten to `./pb-message.js`, and trailing `sourceMappingURL` comments were
removed. Run `pnpm vendor:sync` from the repository root to redo both.

## Why this copy exists

The DataChannel muxer is exactly the building block this transport needs, but
`@libp2p/webrtc` declares only `"."` in its `exports` map:

```
ERR_PACKAGE_PATH_NOT_EXPORTED
Package subpath './muxer.js' is not defined by "exports"
```

A deep import therefore fails in Node and in every bundler that honours the
exports map. Shipping a package that requires each consumer to add a bundler
alias would be a broken contract, so the subtree is vendored instead.

## What is no longer vendored

Up to `@libp2p/webrtc@5.x` this directory also held `maconn.js` and its
`util.js` dependency. Since libp2p 3, the base class they build on -
`AbstractMultiaddrConnection` - is a **public** export of `@libp2p/utils`, so
[`../maconn.js`](../maconn.js) is our own ~40-line adapter on top of it rather
than another copy. That removed 122 lines of vendored code.

## Removing the rest

Upstream issue to track: expose the DataChannel muxer as a public subpath
export. Once `@libp2p/webrtc` exports it, delete this directory and import from
the package.

Because both peers of a QR session run this same code, the vendored muxer only
ever talks to itself - it does not need to stay wire-compatible with the
upstream WebRTC transport. Re-vendoring is still worthwhile for bug fixes:
bump `@libp2p/webrtc` in the root `devDependencies`, run `pnpm vendor:sync`,
update the version noted above, then run `pnpm test`.

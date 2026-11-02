# The results reader

Holds the published field-results database, and mirrors it into a table.

```sh
node bin/reader.js --directory ./data --mirror ./mirror --port 8787
```

## A second home for the dataset, and the thing that makes it a table

[#179](https://github.com/NiKrause/libp2p-webrtc-qr/issues/179) describes this
service as a convenience. An append-only log is easy to write and tedious to
query, so something should mirror it into a table — and it "may be an ordinary
service, because it only reads what is already public".

The first run of the publish half suggested something stronger: six relays
discovered, the database opened at its address, and **no peer joined within
thirty seconds**, so nothing was written. The reading that invited — *a relay
forwards, it does not keep, so only this service can hold the data* — is wrong.
See the measurements below.

What stands is the smaller claim, and it still earns the service: a second,
durable home for a dataset whose other home is somebody else's relay, and the
only thing that turns the log into something queryable.

- **`--directory` is the dataset's home here.** Blocks, heads and keys live
  there. Deleting it does not destroy the dataset while the relay holds it, but
  it does mean re-replicating from scratch.
- **`--mirror` is derived.** The CSV and JSON written there can be deleted at
  any time; they are rebuilt from the log by a fold, not accumulated.
- **It serves blocks.** Not incidental — it is how a relay that knows only the
  address can open the database at all. See below.

## It reads. It does not write

There is no code path in this service that appends to the database, and there
must not be: the reader's only claim to being trustworthy is that it mirrors
claims rather than making them. The way to change what the dataset says is to
publish to it.

That is also why there is no write route on the HTTP side, and why a `POST`
gets a 405 that says so rather than a 404 that implies something is missing.

## What it does with an open database

The published database has `write: ['*']`. That was chosen so the dataset could
keep one address forever — the access controller is part of the address, so an
allow-list would have put the contributors *into* it, and admitting the second
contributor would have stranded everything the first wrote. The price of that
decision is that noise has to be a reader's problem instead of a person's gate,
and [`src/mirror.js`](src/mirror.js) is where that debt is paid:

- **Named fields only.** The mirror copies columns it was taught. A publisher
  that does not use the demo's projection cannot get free text into the public
  CSV by putting it in an entry — the field simply does not travel. Fields this
  reader has not been taught are counted and reported under
  `unknownFields`, because a publisher running ahead of the reader means data
  is being written that nobody is mirroring.
- **The hour grain is a contract.** A row whose timestamp is finer than the hour
  is rejected rather than rounded. Rounding would mean the reader had seen a
  fingerprint, mirrored a clean value and said nothing, while the fingerprint
  stayed in the log for everybody else to read.
- **Vocabulary rejects, length clamps.** A word outside a closed list poisons
  every query somebody later groups by, so it rejects the row. An over-long
  provider name is still a measurement of a real network, so it is truncated
  and counted.
- **Replays are visible.** The same attempt id arriving twice keeps the first
  row. From the same author that is a double publish; from a *different* author
  it is somebody re-signing a measurement that is not theirs, and the two are
  counted separately (`forgedReplays`).
- **A spreadsheet formula is defused.** A cell beginning `=`, `+`, `-` or `@`
  is code to every spreadsheet that opens a CSV, and quoting does not help.
  Such cells are prefixed with an apostrophe.
- **Nothing is dropped silently.** Everything refused is served at
  `/rejected.json` with its reasons. A filter whose removals cannot be
  inspected is an opinion with a URL.

## Routes

| | |
|---|---|
| `/results.csv` | the table, filterable by any low-cardinality column |
| `/results.json` | the same rows |
| `/summary.json` | counts, and what the dataset does not cover |
| `/rejected.json` | what this reader would not mirror, and why |
| `/status.json` | the address, the circuit addresses, whether it is holding |

Filtering is exact match on one column at a time, e.g.
`/results.csv?scenario=mobile-data&country=DE`. Anything with a shape to it
belongs in SQL, which is the point of serving a CSV at all:

```sh
duckdb -c "select provider, count(*) runs,
             count(*) filter (where outcome = 'connected') connected
           from read_csv_auto('http://localhost:8787/results.csv')
           where scenario = 'mobile-data'
           group by 1 order by runs desc"
```

## Reading the columns honestly

**Every column is what a contributor reported.** OrbitDB verifies that an entry
was signed by the identity it claims; nothing verifies that the claim is true.
`provider`, `country` and `outcome` are what somebody's browser said and
somebody typed. The `author` column is there so a flood from one source is
visible rather than averaged into a total — and it is no more than the log
already shows anyone replicating it, so withholding it would hide abuse while
protecting nothing.

- `author` is per publish, not per person. Each publish signs with a fresh
  in-memory identity, so rows published on one evening group together and rows
  from different evenings do not link.
- `families` is what the payload *offered*; `familyFilter` is what it was
  restricted to. Both exist because `families: ['v4']` alone cannot tell "IPv4
  only was asked for" from "this network has no IPv6".
- `hostV4` **over-counts.** The published candidate summary decides the family
  by looking for a colon in the address, and an mDNS stand-in
  (`<uuid>.local`) has none — so obfuscated host candidates land in `hostV4`.
  Where the distinction matters, `families` carries `mdns` explicitly.
- `offeredV6` and `reflexiveV6` in `/summary.json` are the two numbers the
  interesting claim needs. "This carrier does not carry IPv6 UDP" requires both:
  without the denominator, no reflexive IPv6 cannot be told apart from IPv6
  never having been tried.
- `pairId` matches the two halves of a run across two networks. A row without
  one is one-sided by design for a solo scenario and incomplete for scenario B.

## Running it somewhere

It needs **no inbound port, no certificate and no DNS name.** The node takes a
circuit-relay reservation on each relay and listens on the circuit address, so
it is dialable from a browser while sitting behind a domestic NAT. The relays
come from `@le-space/aleph-bootstrap` rather than from a constant, because they
are redeployed and their peer ids change with the deployment — and
`browserDialableOnly` means the reservations land on exactly the relays a
browser can reach. A relay only this service could dial would be a relay no
publisher could ever meet it on.

`--relay <multiaddr>` overrides the list, for testing against a relay of one's
own.

## What was measured, and what the measurements corrected

Run against the live relay list on 1 November 2026, from a laptop behind NAT.

The bootstrap list spans two machines running **different software**, which
turned out to be the whole story:

| | |
|---|---|
| `16Uiu2HAmD1ic…` | a plain libp2p circuit relay — forwards, holds nothing |
| `12D3KooWLG1hL3YJ…` | an `orbitdb-relay` — subscribes to every `/orbitdb/` topic it hears announced, and **pins the database behind it** |

What held:

- six relays discovered, a reservation taken, **24–27 circuit addresses**, so
  it is dialable with no inbound port
- the database opened at
  `/orbitdb/zdpuAtVgsdtFer7kSgkPFjjiNwJy7rQjfefU1ZiFsAQ3oTYQm` — **the same
  address the demo's publish probe reported**, so the agreement holds in
  reality and not only in `test/agreement.test.js`

What corrected an earlier claim here: **the relay does hold this database.**
First measurement said otherwise and the reason was this service's own doing. An
earlier version handed OrbitDB three members of an IPFS node instead of a Helia,
to avoid a native WebRTC dependency, and so served no blocks. The relay then
subscribed to the topic and never opened the database — its `/pinning/stats`
showed `waiting 0, active 0, cooldownTopics 0, timedOutSyncs 0`, so it had tried
and given up rather than being stuck. A relay that learns a database from an
announcement has only the **address**, and opening one by address means fetching
its manifest block over bitswap. Nothing was serving it.

With bitswap restored: the pinner **joined in about two seconds**, and
`/pinning/databases` on the relay went from 148 to 149 entries with our address
among them. So a publisher's thirty-second wait for a peer now resolves.

Still not retried end to end: **an actual publish.** The thirty seconds of
silence on the first attempt was most likely the first holder of a brand-new
database paying a bootstrap cost — the relay has to hear the announcement, fetch
the manifest and open the database before it can join anybody — but that is a
reading, not a measurement, because the publish was never repeated.

One field to read carefully in `/status.json`: `peers` is OrbitDB's own count of
peers that have **joined**, and it is the authoritative one. `subscribers` is
gossipsub's view of the topic and is routinely empty while `peers` is 1, because
a peer reached by fanout rather than through the mesh does not appear there.

Events go to stdout as one JSON object per line. `/status.json` answers "is
publishing possible right now" — it comes up *before* any relay is contacted,
so a monitoring check can tell starting from down.

---

← [libp2p-webrtc-qr](../../README.md) · [ROADMAP](../../ROADMAP.md)

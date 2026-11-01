#!/usr/bin/env node
/**
 * The reader, from a command line.
 *
 * Every option has an environment variable, because this runs as a unit file
 * or in a container more often than it runs from a prompt, and a service whose
 * configuration only exists as flags has to be reconfigured by editing the
 * thing that starts it.
 *
 * `--relay` exists for testing against a relay of one's own. Left out, the
 * current Aleph bootstrap list is discovered, which is what a deployment wants
 * - those addresses change with every redeploy.
 */

import { parseArgs } from 'node:util'

import { start } from '../src/start.js'

const { values } = parseArgs({
  options: {
    directory: { type: 'string', default: process.env.READER_DIRECTORY ?? './data' },
    mirror: { type: 'string', default: process.env.READER_MIRROR ?? '' },
    port: { type: 'string', default: process.env.READER_PORT ?? '8787' },
    host: { type: 'string', default: process.env.READER_HOST ?? '127.0.0.1' },
    relay: { type: 'string', multiple: true, default: [] },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false }
  }
})

if (values.help) {
  process.stdout.write(`Hold the published webrtc-qr field-results database and mirror it into a table.

  --directory <path>   where blocks, heads and keys live (READER_DIRECTORY, default ./data)
  --mirror <path>      also write results.csv / results.json / summary.json here (READER_MIRROR)
  --port <n>           HTTP port (READER_PORT, default 8787)
  --host <addr>        HTTP bind address (READER_HOST, default 127.0.0.1)
  --relay <multiaddr>  use this relay instead of the discovered Aleph list; repeatable
  --quiet              no event log on stdout

The directory is the point of the service: it is what holds the dataset. A
publisher waits for a peer to join before it writes anything, so while this is
not running there is nowhere for anybody's rows to go.
`)
  process.exit(0)
}

const log = values.quiet
  ? () => {}
  // One JSON object per line: readable by a person, greppable, and parseable by
  // whatever collects the service's output without a format to agree on first.
  : event => process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`)

const reader = await start({
  directory: values.directory,
  mirrorDirectory: values.mirror === '' ? null : values.mirror,
  port: Number(values.port),
  host: values.host,
  relays: values.relay.length > 0 ? values.relay : null,
  log
})

log({ type: 'ready', address: reader.address, peerId: reader.peerId, port: reader.port })

let closing = false

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (closing) return

    closing = true
    log({ type: 'closing', signal })
    // Closed rather than left to the exit: an abandoned level store on disk
    // takes a lock with it, and the next start would find its own data busy.
    reader.close().then(() => process.exit(0), () => process.exit(1))
  })
}

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ADDRESS_FAMILIES,
  asAddressFamily,
  candidateAddress,
  familiesOffered,
  familyOf,
  candidateKey,
  filterCandidateLines,
  filterSdpCandidates,
  omitSdpCandidates
} from '../src/families.js'

/**
 * The lever that turns "does IPv6 work between these two networks" from a guess
 * into a run (#179).
 *
 * All of it is string work on an SDP, which is exactly the kind of code that
 * looks obviously right and eats a newline. So it is asserted here rather than
 * through two browsers, where a dropped candidate shows up as a connection that
 * timed out for no stated reason.
 */

const SDP = [
  'v=0',
  'o=- 1 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=ice-ufrag:abcd',
  'a=fingerprint:sha-256 AA:BB',
  'a=candidate:1 1 udp 2122260223 192.168.0.14 54321 typ host generation 0',
  'a=candidate:2 1 udp 2122194687 2003:db8::1 54322 typ host generation 0',
  'a=candidate:3 1 udp 1686052607 203.0.113.9 54323 typ srflx raddr 0.0.0.0 rport 0',
  'a=candidate:4 1 udp 2122129151 9a1b2c3d-dead-beef.local 54324 typ host generation 0',
  'a=end-of-candidates',
  ''
].join('\r\n')

const candidateLines = sdp => sdp.split('\r\n').filter(line => line.startsWith('a=candidate:'))

test('no family asked for returns the very same string, not a rebuilt one', () => {
  // Identity rather than equality: the unfiltered path is the one every
  // ordinary connection takes, and it should not be able to break because of a
  // join in here.
  assert.equal(filterSdpCandidates(SDP, null), SDP)
  assert.equal(filterSdpCandidates(SDP), SDP)
  assert.equal(filterSdpCandidates(SDP, 'both'), SDP)
  assert.equal(filterSdpCandidates(SDP, 'v7'), SDP)
})

test('one family survives and the rest of the SDP is untouched', () => {
  const v6 = filterSdpCandidates(SDP, 'v6')

  assert.deepEqual(candidateLines(v6), [
    'a=candidate:2 1 udp 2122194687 2003:db8::1 54322 typ host generation 0'
  ])

  // Everything that is not a candidate stays, byte for byte - including the
  // trailing CRLF, which is what a parser on the far side splits on.
  assert.equal(
    v6.split('\r\n').filter(line => !line.startsWith('a=candidate:')).join('\r\n'),
    SDP.split('\r\n').filter(line => !line.startsWith('a=candidate:')).join('\r\n')
  )
  assert.ok(v6.endsWith('a=end-of-candidates\r\n'))
  // No blank line where a candidate used to be: the terminator goes with it.
  assert.ok(!v6.includes('\r\n\r\n'))
})

test('IPv4 keeps both the host and the reflexive address', () => {
  const v4 = filterSdpCandidates(SDP, 'v4')

  assert.deepEqual(
    candidateLines(v4).map(line => line.split(' ')[4]),
    ['192.168.0.14', '203.0.113.9']
  )
})

test('an mDNS candidate is dropped by either filter, because its family is unknown', () => {
  // The whole reason this is a decision and not an oversight: a `.local` name
  // resolves to an address nobody here can see. Keeping it under "IPv6 only"
  // would allow a run that connected over IPv4 to be recorded as IPv6 working -
  // the same trap as one phone tethering the other and calling it mobile data.
  for (const family of ADDRESS_FAMILIES) {
    assert.ok(!filterSdpCandidates(SDP, family).includes('.local'), family)
  }

  assert.equal(familyOf('9a1b2c3d-dead-beef.local'), 'mdns')
})

test('filtering down to nothing produces an SDP with no candidates, and says so by having none', () => {
  // Not an error here. The caller is the one that knows whether an invite with
  // no transport address is a finding to report or a payload to refuse, and
  // QRSession refuses it - see session.js.
  const only = 'v=0\r\na=candidate:1 1 udp 1 192.168.0.14 1 typ host\r\n'

  assert.equal(filterSdpCandidates(only, 'v6'), 'v=0\r\n')
})

test('a bare \\n SDP keeps its own line endings', () => {
  // Not the shape a browser produces, and exactly the shape a test fixture or a
  // payload that travelled through a text field does.
  const unix = 'v=0\na=candidate:1 1 udp 1 192.168.0.14 1 typ host\na=candidate:2 1 udp 1 ::1 1 typ host\n'

  assert.equal(filterSdpCandidates(unix, 'v6'), 'v=0\na=candidate:2 1 udp 1 ::1 1 typ host\n')
})

test('compact candidate lines filter the same way, prefix or no prefix', () => {
  const lines = [
    '1 1 udp 2122260223 192.168.0.14 54321 typ host',
    '2 1 udp 2122194687 2003:db8::1 54322 typ host',
    '3 1 udp 2122129151 beef.local 54323 typ host'
  ]

  assert.deepEqual(filterCandidateLines(lines, 'v4'), [lines[0]])
  assert.deepEqual(filterCandidateLines(lines, 'v6'), [lines[1]])
  assert.deepEqual(filterCandidateLines(lines, null), lines)
  assert.deepEqual(filterCandidateLines(undefined, 'v4'), [])

  // The address sits in the same field either way, which is why one reader
  // serves both formats and they cannot drift apart.
  assert.deepEqual(filterCandidateLines(lines.map(line => `a=candidate:${line}`), 'v6'),
    [`a=candidate:${lines[1]}`])
})

test('familiesOffered reports what is there, sorted, and null for nothing', () => {
  const addresses = sdp => candidateLines(sdp).map(candidateAddress)

  assert.deepEqual(familiesOffered(addresses(SDP)), ['mdns', 'v4', 'v6'])
  assert.deepEqual(familiesOffered(addresses(filterSdpCandidates(SDP, 'v4'))), ['v4'])
  assert.equal(familiesOffered([]), null)
  assert.equal(familiesOffered(), null)

  // A candidate that carried no address: counted as nothing rather than as a
  // family called undefined.
  assert.equal(familiesOffered([undefined, '']), null)
})

test('candidateAddress reads the same field with or without the SDP prefix', () => {
  const line = '1 1 udp 2122260223 192.168.0.14 54321 typ host generation 0'

  assert.equal(candidateAddress(line), '192.168.0.14')
  assert.equal(candidateAddress(`a=candidate:${line}`), '192.168.0.14')
  // Short enough to have no address field at all - a malformed line reads as
  // nothing rather than as some other field.
  assert.equal(candidateAddress('1 1 udp'), null)
})

test('the family vocabulary is checked, not trusted', () => {
  assert.equal(asAddressFamily('v4'), 'v4')
  assert.equal(asAddressFamily('v6'), 'v6')
  assert.equal(asAddressFamily('ipv6'), null)
  assert.equal(asAddressFamily(''), null)
  assert.equal(asAddressFamily(null), null)
  assert.equal(asAddressFamily(undefined), null)
})

test('familyOf separates the three answers, including "it did not say"', () => {
  assert.equal(familyOf('192.168.0.14'), 'v4')
  assert.equal(familyOf('2003:db8::1'), 'v6')
  assert.equal(familyOf('::1'), 'v6')
  assert.equal(familyOf('beef.local'), 'mdns')
  assert.equal(familyOf(''), null)
  assert.equal(familyOf(null), null)
  assert.equal(familyOf(undefined), null)
})

/**
 * Leaving named candidates out of one invite (#192).
 *
 * The same string work as the family filter and the same reason to assert it
 * here: a key that drifts between the list being drawn and the selection coming
 * back unchecks the wrong address, and in a browser that looks like a
 * connection which failed for no stated reason.
 */

test('a candidate key survives re-reading the same description', () => {
  const twice = candidateLines(SDP).map(candidateKey)

  assert.deepEqual(twice, candidateLines(SDP).map(candidateKey))
  assert.equal(new Set(twice).size, twice.length, 'keys are unique within one gathering')
})

test('a key distinguishes candidates that share a port', () => {
  // A reflexive candidate and the host candidate it was discovered through
  // share a socket, so they share a port. Address alone would merge them and a
  // checkbox would silently remove both.
  const host = 'a=candidate:1 1 udp 2122260223 192.168.0.14 54321 typ host generation 0'
  const srflx = 'a=candidate:3 1 udp 1686052607 203.0.113.9 54321 typ srflx raddr 0.0.0.0 rport 0'

  assert.notEqual(candidateKey(host), candidateKey(srflx))
})

test('a key reads a bare candidate line the same as an SDP one', () => {
  const line = 'a=candidate:1 1 udp 2122260223 192.168.0.14 54321 typ host generation 0'

  assert.equal(candidateKey(line), candidateKey(line.replace(/^a=candidate:/, '')))
})

test('omitting a candidate removes its line and leaves every other one', () => {
  const lines = candidateLines(SDP)
  const dropped = candidateKey(lines[2])
  const out = omitSdpCandidates(SDP, [dropped])
  const kept = candidateLines(out)

  assert.equal(kept.length, lines.length - 1)
  assert.ok(!kept.some(line => candidateKey(line) === dropped))
  assert.ok(out.includes('a=end-of-candidates'), 'the rest of the description is untouched')
  assert.ok(!/\r\n\r\n/.test(out), 'no blank line is left behind')
})

test('omitting nothing returns the description unchanged, not rebuilt', () => {
  assert.equal(omitSdpCandidates(SDP, []), SDP)
  assert.equal(omitSdpCandidates(SDP), SDP)
  assert.equal(omitSdpCandidates(null, ['anything']), null)
})

test('a key that matches nothing removes nothing', () => {
  assert.equal(omitSdpCandidates(SDP, ['host|udp|10.0.0.1|1']), SDP)
})

test('the family filter and the exclusion compose', () => {
  const v4 = filterSdpCandidates(SDP, 'v4')
  const [first] = candidateLines(v4)

  assert.deepEqual(
    candidateLines(omitSdpCandidates(v4, [candidateKey(first)])).map(candidateAddress),
    ['203.0.113.9']
  )
})

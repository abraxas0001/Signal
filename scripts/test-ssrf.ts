/**
 * SSRF boundary tests.
 *
 * The URL is the whole user input for this product, so this is the one piece of
 * code where a mistake hands an attacker the function's network position. Every
 * case below is a real bypass technique, including three that defeated the
 * original string-matching implementation.
 *
 *   npx tsx scripts/test-ssrf.ts
 */

import { isBlockedAddress, resolvePublicTarget, BlockedAddressError } from '../netlify/functions/lib/ssrf'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const OFF = '\x1b[0m'

let passed = 0
let failed = 0

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  ${GREEN}pass${OFF}  ${name}`)
  } else {
    failed++
    console.log(`  ${RED}FAIL${OFF}  ${name}${detail ? ` ${DIM}${detail}${OFF}` : ''}`)
  }
}

// ─── Literal address classification ─────────────────────────────────────────

console.log(`\n${BOLD}Blocked literal addresses${OFF}`)
const MUST_BLOCK = [
  ['127.0.0.1', 'IPv4 loopback'],
  ['0.0.0.0', 'this-network'],
  ['10.1.2.3', 'private class A'],
  ['172.16.0.1', 'private class B, low edge'],
  ['172.31.255.254', 'private class B, high edge'],
  ['192.168.1.1', 'private class C'],
  ['169.254.169.254', 'cloud metadata endpoint'],
  ['100.64.0.1', 'carrier-grade NAT'],
  ['198.18.0.1', 'benchmarking range'],
  ['224.0.0.1', 'multicast'],
  ['255.255.255.255', 'broadcast'],
  ['::1', 'IPv6 loopback'],
  ['::', 'IPv6 unspecified'],
  ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
  ['::ffff:169.254.169.254', 'IPv4-mapped metadata'],
  ['64:ff9b::127.0.0.1', 'NAT64 loopback'],
  ['fc00::1', 'IPv6 unique-local'],
  ['fd12:3456::1', 'IPv6 unique-local, fd prefix'],
  ['fe80::1', 'IPv6 link-local'],
  ['ff02::1', 'IPv6 multicast'],
  ['2001:db8::1', 'IPv6 documentation'],
  ['not-an-ip', 'garbage'],
] as const

for (const [ip, label] of MUST_BLOCK) {
  check(`${label.padEnd(30)} ${DIM}${ip}${OFF}`, isBlockedAddress(ip))
}

console.log(`\n${BOLD}Allowed public addresses${OFF}`)
const MUST_ALLOW = [
  ['8.8.8.8', 'Google DNS'],
  ['1.1.1.1', 'Cloudflare DNS'],
  ['93.184.216.34', 'example.com'],
  ['172.32.0.1', 'just outside the private class B block'],
  ['172.15.255.255', 'just below the private class B block'],
  ['100.63.255.255', 'just below CGNAT'],
  ['100.128.0.1', 'just above CGNAT'],
  ['2606:4700::1111', 'Cloudflare IPv6'],
  ['2001:4860:4860::8888', 'Google IPv6'],
] as const

for (const [ip, label] of MUST_ALLOW) {
  check(`${label.padEnd(30)} ${DIM}${ip}${OFF}`, !isBlockedAddress(ip))
}

// ─── Full URL validation ────────────────────────────────────────────────────

console.log(`\n${BOLD}URLs that must be rejected${OFF}`)

const REJECT_URLS = [
  ['http://localhost:3000/', 'localhost by name'],
  ['http://127.0.0.1/', 'loopback literal'],
  // These three defeated the original implementation: WHATWG keeps the
  // brackets, so an equality check against the bare address never fired.
  ['http://[::1]:8080/x', 'IPv6 loopback in brackets'],
  ['http://[::ffff:127.0.0.1]:9000/', 'IPv4-mapped loopback in brackets'],
  ['http://[::]:8080/', 'IPv6 unspecified in brackets'],
  ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
  ['http://user:pass@example.com/', 'credentials in the URL'],
  ['ftp://example.com/', 'non-http scheme'],
  ['file:///etc/passwd', 'file scheme'],
  ['http://foo.internal/', '.internal suffix'],
  ['http://printer.local/', '.local suffix'],
  ['http://[fe80::1]/', 'IPv6 link-local'],
] as const

for (const [url, label] of REJECT_URLS) {
  let blocked = false
  let note = ''
  try {
    await resolvePublicTarget(url)
  } catch (e) {
    blocked = e instanceof BlockedAddressError
    note = e instanceof Error ? e.message : ''
  }
  check(`${label.padEnd(36)} ${DIM}${url}${OFF}`, blocked, note)
}

// DNS-dependent cases: real public names that resolve into private space.
// Skipped rather than failed when the network or the domain is unavailable,
// so the suite stays useful offline.
console.log(`\n${BOLD}Public names resolving to private space${OFF} ${DIM}(needs DNS)${OFF}`)
for (const [url, label] of [
  ['http://localtest.me/', 'public name -> 127.0.0.1'],
  ['http://169.254.169.254.nip.io/', 'nip.io -> metadata address'],
] as const) {
  try {
    await resolvePublicTarget(url)
    check(`${label.padEnd(36)} ${DIM}${url}${OFF}`, false, 'was ALLOWED')
  } catch (e) {
    if (e instanceof BlockedAddressError && /private|not be found/.test(e.message)) {
      check(`${label.padEnd(36)} ${DIM}${url}${OFF}`, true)
    } else {
      console.log(`  ${DIM}skip  ${label} (${e instanceof Error ? e.message : 'error'})${OFF}`)
    }
  }
}

console.log(`\n${BOLD}URLs that must be allowed${OFF} ${DIM}(needs DNS)${OFF}`)
for (const url of ['https://example.com/', 'https://x.com/a/status/1']) {
  try {
    const t = await resolvePublicTarget(url)
    check(`${url.padEnd(40)}`, t.addresses.length > 0, `-> ${t.addresses.join(', ')}`)
  } catch (e) {
    console.log(`  ${DIM}skip  ${url} (${e instanceof Error ? e.message : 'error'})${OFF}`)
  }
}

console.log(`\n${BOLD}${passed} passed, ${failed} failed${OFF}\n`)
if (failed > 0) process.exit(1)

import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * The SSRF boundary.
 *
 * The URL is the entire user input for this product, so this file is the only
 * thing standing between a pasted link and the function's network position
 * inside a cloud VPC. It must assume the input is hostile.
 *
 * Three things are needed, and string-matching the hostname gives none of them:
 *
 *  1. WHATWG `URL.hostname` returns IPv6 hosts WITH brackets — `[::1]`, never
 *     `::1` — and normalises `[::ffff:127.0.0.1]` to `[::ffff:7f00:1]`. Any
 *     equality check against a bare address silently never fires.
 *  2. A hostname is not an address. `localtest.me` and `169.254.169.254.nip.io`
 *     are public DNS names that resolve to loopback and to the cloud metadata
 *     endpoint, and no amount of pattern-matching the *name* will catch them.
 *  3. Even after resolving, a second lookup at connect time can return a
 *     different address (DNS rebinding), so the connection has to be pinned to
 *     the address that was actually validated.
 */

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedAddressError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Address classification
// ─────────────────────────────────────────────────────────────────────────────

/** IPv4 ranges that must never be reachable, as [firstOctetMatch, test]. */
function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true // unparseable is not safe
  }
  const [a, b] = parts as [number, number, number, number]

  return (
    a === 0 || //            0.0.0.0/8      "this network"
    a === 10 || //           10.0.0.0/8     private
    a === 127 || //          127.0.0.0/8    loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10  carrier-grade NAT
    (a === 169 && b === 254) || //           169.254.0.0/16 link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || //  172.16.0.0/12  private
    (a === 192 && b === 0) || //             192.0.0.0/24   IETF protocol assignments
    (a === 192 && b === 168) || //           192.168.0.0/16 private
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    a >= 224 //              224.0.0.0/4 multicast and 240.0.0.0/4 reserved
  )
}

/** Expand any IPv6 form to its eight 16-bit groups. */
function expandIPv6(ip: string): number[] | null {
  let addr = ip

  // An IPv4-mapped or NAT64 tail (::ffff:127.0.0.1) needs converting first.
  const tail = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr)
  if (tail?.[1]) {
    const v4 = tail[1].split('.').map(Number)
    if (v4.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    const hi = ((v4[0] as number) << 8) | (v4[1] as number)
    const lo = ((v4[2] as number) << 8) | (v4[3] as number)
    addr = addr.slice(0, tail.index) + ':' + hi.toString(16) + ':' + lo.toString(16)
  }

  const [head, rest, extra] = addr.split('::')
  if (extra !== undefined) return null // more than one "::" is malformed

  const parse = (s: string) => (s ? s.split(':').filter(Boolean).map((g) => parseInt(g, 16)) : [])
  const left = parse(head ?? '')
  const right = rest === undefined ? [] : parse(rest)

  if (rest === undefined) {
    return left.length === 8 && left.every((n) => Number.isInteger(n)) ? left : null
  }

  const fill = 8 - left.length - right.length
  if (fill < 0) return null
  const groups = [...left, ...Array(fill).fill(0), ...right]
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff)
    ? groups
    : null
}

function isBlockedIPv6(ip: string): boolean {
  const g = expandIPv6(ip)
  if (!g) return true // unparseable is not safe

  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as number[]

  // ::/128 unspecified and ::1/128 loopback
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0) {
    return g7 === 0 || g7 === 1
  }
  // ::ffff:0:0/96 — IPv4-mapped. Judge the embedded IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isBlockedIPv4(v4FromGroups(g6 as number, g7 as number))
  }
  // 64:ff9b::/96 — NAT64. Same treatment.
  if (g0 === 0x64 && g1 === 0xff9b) {
    return isBlockedIPv4(v4FromGroups(g6 as number, g7 as number))
  }
  if (((g0 as number) & 0xfe00) === 0xfc00) return true // fc00::/7  unique-local
  if (((g0 as number) & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if (((g0 as number) & 0xff00) === 0xff00) return true // ff00::/8  multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true //      2001:db8::/32 documentation

  return false
}

const v4FromGroups = (hi: number, lo: number) =>
  `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`

/** True when this literal address must not be connected to. */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return isBlockedIPv4(ip)
  if (family === 6) return isBlockedIPv6(ip)
  return true // not an address at all
}

/** WHATWG keeps the brackets on IPv6 hosts; strip them before judging. */
export const debracket = (host: string) => host.replace(/^\[|\]$/g, '')

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa']

export interface ResolvedTarget {
  url: URL
  /** Every address the hostname resolved to, all verified public. */
  addresses: string[]
  family: 4 | 6
}

/**
 * Validate a URL and resolve it to a pinned, verified address.
 * Throws BlockedAddressError with a user-safe message if anything is off.
 */
export async function resolvePublicTarget(rawUrl: string): Promise<ResolvedTarget> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new BlockedAddressError('That is not a valid link.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlockedAddressError('Only http and https links are supported.')
  }

  // Credentials in a URL are a classic way to disguise the real host.
  if (url.username || url.password) {
    throw new BlockedAddressError('Links containing credentials are not accepted.')
  }

  const host = debracket(url.hostname.toLowerCase())
  if (!host) throw new BlockedAddressError('That link has no host.')

  if (host === 'localhost' || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new BlockedAddressError('Local addresses are not allowed.')
  }

  // A literal address needs no DNS, but does need judging.
  const literal = isIP(host)
  if (literal) {
    if (isBlockedAddress(host)) {
      throw new BlockedAddressError('That address is on a private or reserved network.')
    }
    return { url, addresses: [host], family: literal === 4 ? 4 : 6 }
  }

  // A name tells us nothing until it is resolved.
  let records: Array<{ address: string; family: number }>
  try {
    records = await dnsLookup(host, { all: true })
  } catch {
    throw new BlockedAddressError('That address could not be found.')
  }

  if (!records.length) throw new BlockedAddressError('That address could not be found.')

  // Every answer must be public: one private record is enough to attack with.
  for (const r of records) {
    if (isBlockedAddress(r.address)) {
      throw new BlockedAddressError('That link points to a private network address.')
    }
  }

  return {
    url,
    addresses: records.map((r) => r.address),
    family: (records[0] as { family: number }).family === 6 ? 6 : 4,
  }
}

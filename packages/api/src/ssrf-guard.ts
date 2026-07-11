import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// SSRF guard for every server-side fetch of a user-controlled URL (automation
// webhooks, WordPress/Make webhooks, the MCP image proxy).
//
// Two layers of defence:
//  1. assertSafePublicUrl() — reject non-http(s) schemes and resolve the host,
//     rejecting if any resolved address is private/reserved/loopback/metadata.
//  2. A custom DNS `lookup` on the http/https agents re-validates the IP at
//     CONNECTION time (and on every redirect hop). This closes the DNS-
//     rebinding TOCTOU gap: even if the host resolves to a public IP during
//     step 1 and an internal IP microseconds later, the connection is refused.
// ─────────────────────────────────────────────────────────────────────────────

function ipv4ToLong(ip: string): number | null {
  const m = ip.split('.');
  if (m.length !== 4) return null;
  let n = 0;
  for (const part of m) {
    const o = Number(part);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function inV4Cidr(long: number, base: string, bits: number): boolean {
  const baseLong = ipv4ToLong(base);
  if (baseLong === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (long & mask) === (baseLong & mask);
}

function isPrivateIPv4(ip: string): boolean {
  const long = ipv4ToLong(ip);
  if (long === null) return true; // unparseable → treat as unsafe
  return (
    inV4Cidr(long, '0.0.0.0', 8) ||        // "this host"
    inV4Cidr(long, '10.0.0.0', 8) ||       // private
    inV4Cidr(long, '100.64.0.0', 10) ||    // CGNAT
    inV4Cidr(long, '127.0.0.0', 8) ||      // loopback
    inV4Cidr(long, '169.254.0.0', 16) ||   // link-local (incl. 169.254.169.254 metadata)
    inV4Cidr(long, '172.16.0.0', 12) ||    // private
    inV4Cidr(long, '192.0.0.0', 24) ||     // IETF protocol
    inV4Cidr(long, '192.168.0.0', 16) ||   // private
    inV4Cidr(long, '198.18.0.0', 15) ||    // benchmarking
    inV4Cidr(long, '224.0.0.0', 4) ||      // multicast
    inV4Cidr(long, '240.0.0.0', 4)         // reserved
  );
}

export function isPrivateAddress(addr: string): boolean {
  const ip = addr.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) {
    if (ip === '::1' || ip === '::') return true;            // loopback / unspecified
    // IPv4-mapped / -embedded (::ffff:a.b.c.d, ::ffff:0:a.b.c.d, 64:ff9b::a.b.c.d)
    const v4 = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (v4) return isPrivateIPv4(v4[1]);
    const first = ip.split(':')[0] || '';
    const hextet = parseInt(first, 16);
    if (Number.isNaN(hextet)) return true;
    if ((hextet & 0xfe00) === 0xfc00) return true;           // fc00::/7 unique-local
    if ((hextet & 0xffc0) === 0xfe80) return true;           // fe80::/10 link-local
    if (hextet === 0x64 && ip.startsWith('64:ff9b:')) return true; // NAT64
    return false;
  }
  return true; // not a valid IP literal → unsafe
}

// Reject at request time. Returns the parsed URL for reuse.
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(String(rawUrl).trim()); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed');
  if (u.username || u.password) throw new Error('URLs with embedded credentials are not allowed');

  const host = u.hostname.replace(/^\[|\]$/g, '');
  // Literal IP in the URL — check directly, no DNS.
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('URL points to a private or reserved address');
    return u;
  }
  if (host.toLowerCase() === 'localhost') throw new Error('URL points to localhost');

  const results = await dns.promises.lookup(host, { all: true }).catch(() => {
    throw new Error('Could not resolve host');
  });
  if (!results.length) throw new Error('Host did not resolve');
  for (const r of results) {
    if (isPrivateAddress(r.address)) throw new Error('Host resolves to a private or reserved address');
  }
  return u;
}

// Connection-time DNS lookup that refuses private IPs (defeats DNS rebinding).
function guardedLookup(hostname: string, options: any, callback: any): void {
  const cb = typeof options === 'function' ? options : callback;
  const opts = typeof options === 'function' ? {} : options;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses: any) => {
    if (err) return cb(err);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    for (const a of list) {
      if (isPrivateAddress(a.address)) return cb(new Error(`Blocked connection to private address ${a.address}`));
    }
    const first = list[0];
    if (opts && opts.all) return cb(null, list);
    return cb(null, first.address, first.family);
  });
}

const guardedHttpAgent = new http.Agent({ lookup: guardedLookup as any });
const guardedHttpsAgent = new https.Agent({ lookup: guardedLookup as any });

// Drop-in axios request that is validated up front AND pinned to safe IPs at
// connection/redirect time. Caps redirects and body size.
export async function safeAxios<T = unknown>(config: AxiosRequestConfig & { url: string }): Promise<AxiosResponse<T>> {
  await assertSafePublicUrl(config.url);
  return axios.request<T>({
    ...config,
    httpAgent: guardedHttpAgent,
    httpsAgent: guardedHttpsAgent,
    maxRedirects: config.maxRedirects ?? 2,
    maxContentLength: config.maxContentLength ?? 25 * 1024 * 1024,
    maxBodyLength: config.maxBodyLength ?? 25 * 1024 * 1024,
    timeout: config.timeout ?? 15_000,
  });
}

import { isIP } from 'node:net';
import { promises as dnsPromises } from 'node:dns';
import type { FetchedText, UrlFetcher } from '@devdigest/shared';
import { AppError, ExternalServiceError } from '../../platform/errors.js';

/**
 * UrlFetcher over the Node global `fetch` (undici). The adapter contract:
 * fetch a small TEXT document over https from a user-supplied URL with
 * mechanical SSRF/size/time guards, or throw — it never returns partial or
 * unguarded data:
 *
 * - `assertFetchableUrl` (re-run on EVERY redirect hop): parseable URL,
 *   https only, no IP-literal hostnames, and every DNS-resolved address
 *   must be public — loopback, RFC1918, CGNAT 100.64/10, link-local and
 *   unspecified addresses are rejected, with IPv4-mapped IPv6
 *   (::ffff:a.b.c.d) normalized to its embedded v4 before the range check.
 * - Redirects are followed manually (≤ maxRedirects) so each hop is
 *   re-validated; one `AbortSignal.timeout` bounds the whole call.
 * - The size cap is enforced twice: declared `content-length` up front, and
 *   the body stream itself (the read aborts as soon as the cap is crossed —
 *   a lying header can never make us buffer unbounded).
 * - Content-type must be absent or text-ish (`text/*`,
 *   `application/markdown`, `application/x-markdown`,
 *   `application/octet-stream`); upstream status ≥ 400 is an error.
 *
 * Known limits (deliberate; recorded in specs/02-skills.md "URL import"):
 * - DNS-rebinding TOCTOU: the guard validates the addresses of ONE lookup,
 *   then `fetch` resolves the hostname again on its own — a rebinding
 *   attacker can answer the second query with a private address. The full
 *   fix is a pinned-IP dispatcher (connect to a validated address and set
 *   the Host header ourselves); future work. Accepted because the blast
 *   radius is one size-capped https GET whose body is untrusted anyway.
 * - Redirect-hop bodies are neither read nor scanned (only Location is);
 *   the bytes that matter are the final 2xx body.
 */

/** Dotted quad → 32-bit BigInt; null when not exactly four 0-255 octets. */
function ipv4ToBigInt(addr: string): bigint | null {
  const octets = addr.split('.');
  if (octets.length !== 4) return null;
  let value = 0n;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const n = Number(octet);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

/**
 * IPv6 text (with `::` elision, an optional trailing IPv4 quad, and an
 * optional `%zone` suffix) → 128-bit BigInt; null when malformed.
 */
function ipv6ToBigInt(addr: string): bigint | null {
  const raw = addr.replace(/%.*$/, '');
  const doubleColon = raw.split('::').length - 1;
  if (doubleColon > 1) return null;
  const [leftRaw = '', rightRaw] = raw.split('::');

  const parseGroups = (part: string): bigint[] | null => {
    if (part === '') return [];
    const groups: bigint[] = [];
    const parts = part.split(':');
    for (let i = 0; i < parts.length; i++) {
      const group = parts[i];
      if (group === undefined) return null;
      if (group.includes('.')) {
        // IPv4 tail (e.g. ::ffff:127.0.0.1) — only valid as the last group.
        if (i !== parts.length - 1) return null;
        const v4 = ipv4ToBigInt(group);
        if (v4 === null) return null;
        groups.push((v4 >> 16n) & 0xffffn, v4 & 0xffffn);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        groups.push(BigInt(parseInt(group, 16)));
      }
    }
    return groups;
  };

  const left = parseGroups(leftRaw);
  const right = rightRaw === undefined ? [] : parseGroups(rightRaw);
  if (left === null || right === null) return null;
  const total = left.length + right.length;
  if (total > 8) return null;
  if (doubleColon === 0 && total !== 8) return null;
  const fill = doubleColon === 1 ? 8 - total : 0;
  if (fill < 1 && doubleColon === 1) return null;

  const groups = [
    ...left,
    ...Array.from({ length: fill }, () => 0n),
    ...right,
  ];
  return groups.reduce((acc, group) => (acc << 16n) | group, 0n);
}

/** [network, broadcast] BigInt range of `base/prefixBits` for 32-bit v4. */
function v4Range(base: string, prefixBits: number): [bigint, bigint] {
  const hostBits = BigInt(32 - prefixBits);
  const network = (ipv4ToBigInt(base) ?? 0n) >> hostBits << hostBits;
  return [network, network | ((1n << hostBits) - 1n)];
}

/** [network, last] BigInt range of `base/prefixBits` for 128-bit v6. */
function v6Range(base: bigint, prefixBits: number): [bigint, bigint] {
  const hostBits = BigInt(128 - prefixBits);
  const network = base >> hostBits << hostBits;
  return [network, network | ((1n << hostBits) - 1n)];
}

const BLOCKED_V4_RANGES: readonly [bigint, bigint][] = [
  v4Range('0.0.0.0', 8), // unspecified ("this host") block
  v4Range('10.0.0.0', 8), // RFC1918 private
  v4Range('100.64.0.0', 10), // CGNAT shared
  v4Range('127.0.0.0', 8), // loopback
  v4Range('169.254.0.0', 16), // link-local
  v4Range('172.16.0.0', 12), // RFC1918 private
  v4Range('192.168.0.0', 16), // RFC1918 private
];

const BLOCKED_V6_RANGES: readonly [bigint, bigint][] = [
  v6Range(0n, 128), // :: unspecified
  v6Range(1n, 128), // ::1 loopback
  v6Range(0xfe80n << 112n, 10), // fe80::/10 link-local
];

const IPV4_MAPPED = v6Range(0xffffn << 32n, 96); // ::ffff:0:0/96

function inRanges(value: bigint, ranges: readonly [bigint, bigint][]): boolean {
  return ranges.some(([lo, hi]) => value >= lo && value <= hi);
}

/**
 * True when the resolved address may not be fetched: loopback, private,
 * CGNAT, link-local or unspecified. IPv4-mapped IPv6 is normalized to its
 * embedded v4 first. Unparseable addresses fail CLOSED.
 */
function isDisallowedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const v = ipv4ToBigInt(address);
    return v === null || inRanges(v, BLOCKED_V4_RANGES);
  }
  if (family === 6) {
    const v = ipv6ToBigInt(address);
    if (v === null) return true;
    if (inRanges(v, BLOCKED_V6_RANGES)) return true;
    if (v >= IPV4_MAPPED[0] && v <= IPV4_MAPPED[1]) {
      const embeddedV4 = v & 0xffff_ffffn;
      return inRanges(embeddedV4, BLOCKED_V4_RANGES);
    }
    return false;
  }
  return true;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'application/markdown',
  'application/x-markdown',
  'application/octet-stream',
]);

/** Base media type before `;`, lowercased (`text/markdown; charset=utf-8` → `text/markdown`). */
function contentTypeBase(raw: string): string {
  return (raw.split(';', 1)[0] ?? '').trim().toLowerCase();
}

function isAllowedContentType(raw: string): boolean {
  const base = contentTypeBase(raw);
  return base.startsWith('text/') || ALLOWED_CONTENT_TYPES.has(base);
}

/** Statuses whose Location we follow (300/304/305 are not redirects to us). */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function transportMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'request timed out';
    return err.message;
  }
  return 'unknown transport error';
}

export interface FetchUrlFetcherOptions {
  /** Wall-clock budget for the whole call (DNS + all hops + body), default 10s. */
  timeoutMs?: number;
  /** Hard cap on response bytes, default 1 MiB. */
  maxBytes?: number;
  /** Redirect hops followed before erroring, default 3. */
  maxRedirects?: number;
}

/** FetchUrlFetcher — guarded https GET → FetchedText (see module header). */
export class FetchUrlFetcher implements UrlFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor({
    timeoutMs = 10_000,
    maxBytes = 1_048_576,
    maxRedirects = 3,
  }: FetchUrlFetcherOptions = {}) {
    this.timeoutMs = timeoutMs;
    this.maxBytes = maxBytes;
    this.maxRedirects = maxRedirects;
  }

  async fetchText(rawUrl: string): Promise<FetchedText> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let current = await this.assertFetchableUrl(rawUrl);
    let response = await this.fetchOnce(current, signal);

    for (let hops = 0; isRedirectStatus(response.status); ) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ExternalServiceError('Redirect response is missing its Location header');
      }
      if (hops >= this.maxRedirects) {
        throw new ExternalServiceError(`More than ${this.maxRedirects} redirects`);
      }
      hops += 1;
      let next: URL;
      try {
        next = new URL(location, current); // resolves relative Location
      } catch {
        throw new ExternalServiceError('Redirect Location is not a valid URL');
      }
      current = await this.assertFetchableUrl(next);
      response = await this.fetchOnce(current, signal);
    }

    const contentType = response.headers.get('content-type');
    if (contentType !== null && !isAllowedContentType(contentType)) {
      throw new ExternalServiceError(`Unsupported content type "${contentTypeBase(contentType)}"`);
    }

    // Cap 1/2: trust the declared length when it already condemns the body.
    const declared = response.headers.get('content-length');
    if (declared !== null) {
      const declaredBytes = Number(declared);
      if (Number.isFinite(declaredBytes) && declaredBytes > this.maxBytes) {
        throw new ExternalServiceError(`Response exceeds the ${this.maxBytes}-byte size limit`);
      }
    }

    if (!response.body) {
      return { text: '', contentType, bytes: 0 };
    }

    // Cap 2/2: stream-read with a hard byte budget — a lying (or absent)
    // content-length can never make us buffer more than maxBytes + one chunk.
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let bytes = 0;
    let text = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.maxBytes) {
          await reader.cancel().catch(() => {});
          throw new ExternalServiceError(`Response exceeds the ${this.maxBytes}-byte size limit`);
        }
        text += decoder.decode(value, { stream: true });
      }
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      throw new ExternalServiceError('Failed while reading the response body');
    }
    text += decoder.decode(); // flush the decoder's tail
    return { text, contentType, bytes };
  }

  /**
   * SSRF guard: https-only, no IP literals, and every DNS-resolved address
   * public. Returns the parsed URL (so callers never re-parse unvalidated
   * input). Guard failures are AppError('url_not_allowed', 422).
   */
  private async assertFetchableUrl(input: string | URL): Promise<URL> {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new AppError('url_not_allowed', 'The URL is malformed', 422);
    }
    if (url.protocol !== 'https:') {
      throw new AppError('url_not_allowed', 'Only https:// URLs can be imported', 422);
    }
    // WHATWG URL.hostname keeps IPv6 brackets; net.isIP wants them gone.
    const host =
      url.hostname.startsWith('[') && url.hostname.endsWith(']')
        ? url.hostname.slice(1, -1)
        : url.hostname;
    if (isIP(host) !== 0) {
      throw new AppError('url_not_allowed', 'IP-address URLs are not allowed', 422);
    }
    let addresses: { address: string }[];
    try {
      addresses = await dnsPromises.lookup(host, { all: true });
    } catch {
      throw new ExternalServiceError(`Could not resolve "${host}"`);
    }
    for (const { address } of addresses) {
      if (isDisallowedAddress(address)) {
        throw new AppError('url_not_allowed', `"${host}" resolves to a non-public address`, 422);
      }
    }
    return url;
  }

  /**
   * One hop. We race the fetch against the abort signal ourselves: undici
   * rejects on abort, but the explicit race keeps the wall-clock bound true
   * even if the underlying dispatcher lingers on the signal.
   */
  private async fetchOnce(url: URL, signal: AbortSignal): Promise<Response> {
    // An already-fired signal never emits 'abort' again — check it directly so
    // a hop starting after the budget expired (e.g. slow DNS) still fails fast.
    if (signal.aborted) {
      throw new ExternalServiceError(`Fetch timed out after ${this.timeoutMs}ms`);
    }
    const onAbort = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        reject(new ExternalServiceError(`Fetch timed out after ${this.timeoutMs}ms`));
      });
    });
    let response: Response;
    try {
      response = await Promise.race([fetch(url, { redirect: 'manual', signal }), onAbort]);
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      throw new ExternalServiceError(`URL fetch failed: ${transportMessage(err)}`);
    }
    if (response.status >= 400) {
      // Status only — upstream bodies are never echoed into error messages.
      throw new ExternalServiceError(`Upstream responded with HTTP ${response.status}`);
    }
    return response;
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchUrlFetcher } from './url-fetch.js';

/**
 * Hermetic — NO network. `fetch` is stubbed globally and `node:dns` is
 * mocked so `dns.promises.lookup` resolves to whatever the test pins. Pins
 * the SSRF guard (scheme / IP literals / DNS-resolved ranges), redirect
 * re-validation, the two-layer size cap, the content-type allowlist, the
 * timeout bound, and upstream-status error mapping.
 */

const dnsLookup = vi.hoisted(() => vi.fn());

vi.mock('node:dns', () => ({
  promises: { lookup: dnsLookup },
}));

const PUBLIC_IP = '93.184.216.34';
const fetchMock = vi.fn();

function resolvesTo(address: string, family = 4): void {
  dnsLookup.mockResolvedValue([{ address, family }]);
}

function textResponse(body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers });
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

beforeEach(() => {
  dnsLookup.mockReset();
  resolvesTo(PUBLIC_IP);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('URL guard (rejects before any fetch)', () => {
  it('rejects non-URL garbage with url_not_allowed (422)', async () => {
    await expect(new FetchUrlFetcher().fetchText('not a url')).rejects.toMatchObject({
      code: 'url_not_allowed',
      statusCode: 422,
    });
    expect(dnsLookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects http:// URLs with url_not_allowed (422)', async () => {
    await expect(
      new FetchUrlFetcher().fetchText('http://example.com/skill.md'),
    ).rejects.toMatchObject({ code: 'url_not_allowed', statusCode: 422 });
    expect(dnsLookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://[::1]/x',
    'https://169.254.1.1/x',
  ])('rejects IP-literal host %s without fetching', async (url) => {
    await expect(new FetchUrlFetcher().fetchText(url)).rejects.toMatchObject({
      code: 'url_not_allowed',
      statusCode: 422,
    });
    expect(dnsLookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    '192.168.1.5', // RFC1918
    '10.0.0.9',
    '172.16.0.3',
    '172.31.255.1',
    '100.64.0.7', // CGNAT
    '169.254.9.9', // link-local
    '127.0.0.1', // loopback via DNS
    '0.0.0.0', // unspecified
    '::1', // v6 loopback
    'fe80::1', // v6 link-local
    '::ffff:192.168.0.1', // IPv4-mapped v6 → embedded v4 range check
  ])('rejects a hostname resolving to %s', async (address) => {
    const family = address.includes(':') ? 6 : 4;
    resolvesTo(address, family);
    await expect(
      new FetchUrlFetcher().fetchText('https://example.com/skill.md'),
    ).rejects.toMatchObject({ code: 'url_not_allowed', statusCode: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when ANY resolved address is non-public (mixed records)', async () => {
    dnsLookup.mockResolvedValue([
      { address: PUBLIC_IP, family: 4 },
      { address: '10.0.0.9', family: 4 },
    ]);
    await expect(
      new FetchUrlFetcher().fetchText('https://example.com/skill.md'),
    ).rejects.toMatchObject({ code: 'url_not_allowed', statusCode: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a DNS failure to external_service_error', async () => {
    dnsLookup.mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      new FetchUrlFetcher().fetchText('https://missing.example.com/x'),
    ).rejects.toMatchObject({ code: 'external_service_error', statusCode: 502 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes a public resolution through to fetch', async () => {
    fetchMock.mockResolvedValue(textResponse('# hi', { 'content-type': 'text/markdown' }));
    const out = await new FetchUrlFetcher().fetchText('https://example.com/skill.md');
    expect(out.text).toBe('# hi');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://example.com/skill.md');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
  });
});

describe('content type', () => {
  const url = 'https://example.com/skill.md';

  it('rejects image/png with external_service_error', async () => {
    fetchMock.mockResolvedValue(textResponse('binary', { 'content-type': 'image/png' }));
    await expect(new FetchUrlFetcher().fetchText(url)).rejects.toMatchObject({
      code: 'external_service_error',
      statusCode: 502,
    });
  });

  it.each([
    ['text/markdown; charset=utf-8', 'text/markdown; charset=utf-8'],
    ['application/octet-stream', 'application/octet-stream'],
    ['application/x-markdown', 'application/x-markdown'],
    ['TEXT/PLAIN; charset=utf-8', 'TEXT/PLAIN; charset=utf-8'], // base is lowercased
  ])('allows %s', async (contentType, echoed) => {
    fetchMock.mockResolvedValue(textResponse('x', { 'content-type': contentType }));
    const out = await new FetchUrlFetcher().fetchText(url);
    expect(out.contentType).toBe(echoed);
  });

  it('allows an absent content-type and echoes null', async () => {
    // Stream body: undici only auto-sets content-type for string bodies, so a
    // stream leaves the header genuinely absent (like a real headerless 200).
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('# no type'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
    const out = await new FetchUrlFetcher().fetchText(url);
    expect(out.text).toBe('# no type');
    expect(out.contentType).toBeNull();
  });
});

describe('size cap', () => {
  const url = 'https://example.com/skill.md';

  it('rejects a condemning content-length before reading the body', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([35]));
      },
    });
    const getReader = vi.spyOn(body, 'getReader');
    fetchMock.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-length': '2000000' } }),
    );
    await expect(new FetchUrlFetcher().fetchText(url)).rejects.toMatchObject({
      code: 'external_service_error',
      statusCode: 502,
    });
    expect(getReader).not.toHaveBeenCalled();
  });

  it('aborts mid-stream when a lying (absent) content-length hides an oversize body', async () => {
    const chunk = new Uint8Array(600 * 1024); // 600 KB; 2 chunks > 1 MiB default cap
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    await expect(new FetchUrlFetcher().fetchText(url)).rejects.toMatchObject({
      code: 'external_service_error',
      statusCode: 502,
    });
    expect(cancelled).toBe(true);
  });
});

describe('timeout', () => {
  it('bounds the whole call: a fetch that never resolves still errors (real timers)', async () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    const fetcher = new FetchUrlFetcher({ timeoutMs: 20 });
    await expect(fetcher.fetchText('https://example.com/skill.md')).rejects.toMatchObject({
      code: 'external_service_error',
      statusCode: 502,
      message: expect.stringMatching(/timed out/i),
    });
  });
});

describe('upstream status', () => {
  it('maps >= 400 to external_service_error without echoing the body', async () => {
    fetchMock.mockResolvedValue(new Response('SECRET-UPSTREAM-BODY', { status: 404 }));
    const err = await new FetchUrlFetcher()
      .fetchText('https://example.com/skill.md')
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'external_service_error', statusCode: 502 });
    expect((err as Error).message).toContain('404');
    expect((err as Error).message).not.toContain('SECRET-UPSTREAM-BODY');
  });
});

describe('redirects', () => {
  it('re-validates every hop: a redirect to an IP literal is rejected', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse('https://127.0.0.2/next'));
    await expect(
      new FetchUrlFetcher().fetchText('https://example.com/skill.md'),
    ).rejects.toMatchObject({ code: 'url_not_allowed', statusCode: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-validates every hop: a redirect to a privately-resolving host is rejected', async () => {
    fetchMock.mockResolvedValueOnce(redirectResponse('https://internal.example.com/next'));
    dnsLookup
      .mockResolvedValueOnce([{ address: PUBLIC_IP, family: 4 }]) // example.com
      .mockResolvedValueOnce([{ address: '192.168.1.5', family: 4 }]); // internal.example.com
    await expect(
      new FetchUrlFetcher().fetchText('https://example.com/skill.md'),
    ).rejects.toMatchObject({ code: 'url_not_allowed', statusCode: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects when more than maxRedirects hops are needed', async () => {
    for (let i = 0; i < 4; i++) {
      fetchMock.mockResolvedValueOnce(redirectResponse(`/hop/${i + 1}`));
    }
    fetchMock.mockResolvedValue(textResponse('# never reached'));
    await expect(
      new FetchUrlFetcher().fetchText('https://example.com/skill.md'),
    ).rejects.toMatchObject({ code: 'external_service_error', statusCode: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('follows relative and cross-host hops, returning the final body', async () => {
    fetchMock
      .mockResolvedValueOnce(redirectResponse('/one', 301))
      .mockResolvedValueOnce(redirectResponse('https://other.example.com/two', 302))
      .mockResolvedValueOnce(
        textResponse('# hi', { 'content-type': 'text/markdown; charset=utf-8' }),
      );
    const out = await new FetchUrlFetcher().fetchText('https://example.com/skill.md');
    expect(out).toMatchObject({ text: '# hi', contentType: 'text/markdown; charset=utf-8', bytes: 4 });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://example.com/skill.md',
      'https://example.com/one', // relative Location resolved against the current URL
      'https://other.example.com/two',
    ]);
    expect(dnsLookup).toHaveBeenCalledTimes(3); // initial + both hops re-validated
  });
});

describe('body assembly', () => {
  it('joins streamed chunks with TextDecoder (codepoint split across chunks) and counts bytes', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // '# héi' with é (0xc3 0xa9) split across the chunk boundary.
        controller.enqueue(new Uint8Array([0x23, 0x20, 0x68, 0xc3]));
        controller.enqueue(new Uint8Array([0xa9, 0x69]));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const out = await new FetchUrlFetcher().fetchText('https://example.com/skill.md');
    expect(out.text).toBe('# héi');
    expect(out.bytes).toBe(6);
  });
});

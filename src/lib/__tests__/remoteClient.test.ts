/**
 * Remote Web Player client: request shapes, auth, error mapping and the
 * capability stream URL. The phone side is covered by its JVM tests; here a
 * stubbed fetch stands in for the bridge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RemoteClient, RemoteError, normalizeBaseUrl } from '../remoteClient';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function stubFetch(handler: (call: RecordedCall) => { status?: number; json?: unknown }) {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const call: RecordedCall = {
        url,
        method: init.method ?? 'GET',
        headers: (init.headers ?? {}) as Record<string, string>,
        body: init.body as string | undefined,
      };
      calls.push(call);
      const result = handler(call);
      return {
        ok: (result.status ?? 200) < 400,
        status: result.status ?? 200,
        json: async () => result.json ?? {},
      } as Response;
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeBaseUrl', () => {
  it('adds a scheme and strips trailing slashes', () => {
    expect(normalizeBaseUrl('  example.lhr.life/ ')).toBe('http://example.lhr.life');
    expect(normalizeBaseUrl('https://example.lhr.life///')).toBe('https://example.lhr.life');
    expect(normalizeBaseUrl('192.168.1.20:8930')).toBe('http://192.168.1.20:8930');
  });
});

describe('RemoteClient', () => {
  it('health verifies the bridge identity', async () => {
    stubFetch(() => ({ json: { ok: true, service: 'soundwave-remote', apiVersion: 1 } }));
    const client = new RemoteClient('https://phone.example');
    await expect(client.health()).resolves.toMatchObject({ ok: true, apiVersion: 1 });
  });

  it('health rejects a random HTTP server', async () => {
    stubFetch(() => ({ json: { hello: 'world' } }));
    const client = new RemoteClient('https://phone.example');
    await expect(client.health()).rejects.toMatchObject({ code: 'NOT_A_BRIDGE' });
  });

  it('pairs without auth, then sends the bearer token', async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith('/api/pair')) {
        return { json: { sessionToken: 'tok123', expiresAtMs: 42, label: 'session …x' } };
      }
      return { json: { results: [] } };
    });
    const client = new RemoteClient('https://phone.example/');
    const paired = await client.pair(' 123456 ');
    expect(paired.sessionToken).toBe('tok123');
    expect(calls[0].headers['Authorization']).toBeUndefined();
    expect(JSON.parse(calls[0].body!)).toEqual({ code: '123456' });

    await client.search('rick astley');
    expect(calls[1].url).toBe('https://phone.example/api/search?q=rick%20astley&limit=20');
    expect(calls[1].headers['Authorization']).toBe('Bearer tok123');
  });

  it('maps structured bridge errors', async () => {
    stubFetch(() => ({
      status: 401,
      json: { error: { code: 'PAIRING_INVALID', message: 'Incorrect pairing code.' } },
    }));
    const client = new RemoteClient('https://phone.example');
    const err = await client.pair('000000').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RemoteError);
    expect(err).toMatchObject({ code: 'PAIRING_INVALID', status: 401 });
  });

  it('builds a capability stream URL with the session token', () => {
    const client = new RemoteClient('https://phone.example');
    client.setToken('tok 123');
    expect(client.streamUrl('/api/stream/abc')).toBe(
      'https://phone.example/api/stream/abc?t=tok%20123',
    );
  });

  it('refuses to build a stream URL before pairing', () => {
    const client = new RemoteClient('https://phone.example');
    expect(() => client.streamUrl('/api/stream/abc')).toThrowError(/Pair with SoundWave/);
  });

  it('resolve posts only the track id', async () => {
    const calls = stubFetch(() => ({
      json: {
        track: null,
        streamPath: '/api/stream/xyz',
        contentType: 'audio/mp4',
        safariCompatible: true,
        streamExpiresAtMs: 1,
        upstreamExpiresAtMs: 2,
        resolverClient: 'test',
      },
    }));
    const client = new RemoteClient('https://phone.example');
    client.setToken('t');
    const resolved = await client.resolve('dQw4w9WgXcQ');
    expect(resolved.safariCompatible).toBe(true);
    expect(JSON.parse(calls[0].body!)).toEqual({ trackId: 'dQw4w9WgXcQ' });
    // The client must never receive (or invent) an upstream URL.
    expect(JSON.stringify(resolved)).not.toContain('googlevideo');
  });
});

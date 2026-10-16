/**
 * Client for the SoundWave Remote Web Player bridge.
 *
 * The bridge is an HTTP API served by the SoundWave Android app itself
 * (Settings → Remote Web Player). The phone searches YouTube Music and
 * resolves a playable source; this client only ever receives metadata and
 * an expiring, session-bound stream path — never the upstream URL.
 *
 * Playback happens here in the browser. Nothing in this file can reach the
 * phone's own player: the bridge has no endpoint for that.
 */

export interface RemoteTrack {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  durationSec?: number | null;
  thumbnailUrl?: string | null;
  explicit?: boolean;
}

export interface RemoteHealth {
  ok: boolean;
  service: string;
  apiVersion: number;
  pairingRequired: boolean;
  nowMs: number;
}

export interface ResolvedStream {
  track: RemoteTrack | null;
  streamPath: string;
  contentType: string;
  safariCompatible: boolean;
  streamExpiresAtMs: number;
  upstreamExpiresAtMs: number;
  resolverClient: string;
}

export interface RemoteSessionInfo {
  createdAtMs: number;
  expiresAtMs: number;
  lastSeenAtMs: number;
  label: string;
}

export interface RemoteItem {
  type: 'song' | 'album' | 'artist' | 'playlist' | 'mood';
  id: string;
  title: string;
  subtitle?: string | null;
  thumbnailUrl?: string | null;
  durationSec?: number | null;
  explicit?: boolean;
  /** Album year, playlist song count, or mood colour (#rrggbb). */
  extra?: string | null;
}

export interface RemoteSection {
  title: string;
  label?: string | null;
  items: RemoteItem[];
}

export interface RemoteDetail {
  kind: 'album' | 'artist' | 'playlist';
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  thumbnailUrl?: string | null;
  songs: RemoteTrack[];
  sections: RemoteSection[];
}

/** Playable track view of a song-type catalogue item. */
export function itemToTrack(item: RemoteItem): RemoteTrack {
  return {
    id: item.id,
    title: item.title,
    artist: item.subtitle ?? '',
    album: item.extra ?? null,
    durationSec: item.durationSec ?? null,
    thumbnailUrl: item.thumbnailUrl ?? null,
    explicit: item.explicit ?? false,
  };
}

/** The playable songs inside a mixed catalogue section, as tracks. */
export function sectionTracks(section: RemoteSection): RemoteTrack[] {
  return section.items.filter((i) => i.type === 'song').map(itemToTrack);
}

export class RemoteError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 0) {
    super(message);
    this.name = 'RemoteError';
    this.code = code;
    this.status = status;
  }
}

/** Normalize a user-typed bridge address (`host`, `host/`, missing scheme). */
export function normalizeBaseUrl(raw: string): string {
  let base = raw.trim();
  if (!base) return '';
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  return base.replace(/\/+$/, '');
}

export class RemoteClient {
  private base: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.base = normalizeBaseUrl(baseUrl);
  }

  get baseUrl(): string {
    return this.base;
  }

  setBaseUrl(baseUrl: string): void {
    this.base = normalizeBaseUrl(baseUrl);
  }

  setToken(token: string | null): void {
    this.token = token;
  }

  get hasToken(): boolean {
    return !!this.token;
  }

  /** Public liveness probe. Also proves the address is a SoundWave bridge. */
  async health(timeoutMs = 12_000): Promise<RemoteHealth> {
    const data = await this.request<RemoteHealth>('/api/health', { timeoutMs, auth: false });
    if (!data || data.ok !== true || data.service !== 'soundwave-remote') {
      throw new RemoteError(
        'NOT_A_BRIDGE',
        'That address answered, but not as a SoundWave bridge. Check the address (and port 8930).',
      );
    }
    return data;
  }

  /** Exchange the 6-digit pairing code from the app for a session token. */
  async pair(code: string): Promise<{ sessionToken: string; expiresAtMs: number; label: string }> {
    const data = await this.request<{ sessionToken: string; expiresAtMs: number; label: string }>(
      '/api/pair',
      { method: 'POST', body: { code: code.trim() }, auth: false, timeoutMs: 15_000 },
    );
    this.token = data.sessionToken;
    return data;
  }

  async session(): Promise<{ session: RemoteSessionInfo; apiVersion: number }> {
    return this.request('/api/session');
  }

  /** Revoke this session on the phone, then forget the token locally. */
  async revoke(): Promise<void> {
    try {
      await this.request('/api/session', { method: 'DELETE' });
    } finally {
      this.token = null;
    }
  }

  async search(query: string, limit = 20): Promise<RemoteTrack[]> {
    const data = await this.request<{ results: RemoteTrack[] }>(
      `/api/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      { timeoutMs: 30_000 },
    );
    return data.results ?? [];
  }

  /** Home-feed song recommendations from the phone (same source as the app's Home). */
  async recommendations(limit = 24): Promise<RemoteTrack[]> {
    const data = await this.request<{ results: RemoteTrack[] }>(
      `/api/recommendations?limit=${limit}`,
      { timeoutMs: 30_000 },
    );
    return data.results ?? [];
  }

  /** Home feed shelves from the phone (quick picks, albums, artists…). */
  async home(): Promise<RemoteSection[]> {
    const data = await this.request<{ sections: RemoteSection[] }>('/api/home', { timeoutMs: 45_000 });
    return data.sections ?? [];
  }

  /** Typed search: albums, artists or playlists (songs use search()). */
  async searchItems(query: string, type: 'album' | 'artist' | 'playlist', limit = 20): Promise<RemoteItem[]> {
    const data = await this.request<{ results: RemoteItem[] }>(
      `/api/search?q=${encodeURIComponent(query)}&type=${type}&limit=${limit}`,
      { timeoutMs: 30_000 },
    );
    return data.results ?? [];
  }

  /** Album / artist / playlist page from the phone. */
  async detail(kind: 'album' | 'artist' | 'playlist', id: string): Promise<RemoteDetail> {
    const data = await this.request<{ detail: RemoteDetail }>(
      `/api/${kind}/${encodeURIComponent(id)}`,
      { timeoutMs: 45_000 },
    );
    return data.detail;
  }

  async charts(): Promise<RemoteSection[]> {
    const data = await this.request<{ sections: RemoteSection[] }>('/api/charts', { timeoutMs: 45_000 });
    return data.sections ?? [];
  }

  async explore(): Promise<RemoteSection[]> {
    const data = await this.request<{ sections: RemoteSection[] }>('/api/explore', { timeoutMs: 45_000 });
    return data.sections ?? [];
  }

  /** Generic browse (mood tiles and other shelves the phone can resolve). */
  async browse(id: string, params?: string | null): Promise<RemoteSection[]> {
    const q = params ? `&params=${encodeURIComponent(params)}` : '';
    const data = await this.request<{ sections: RemoteSection[] }>(
      `/api/browse?id=${encodeURIComponent(id)}${q}`,
      { timeoutMs: 45_000 },
    );
    return data.sections ?? [];
  }

  async track(trackId: string): Promise<RemoteTrack> {
    const data = await this.request<{ track: RemoteTrack }>(`/api/track/${encodeURIComponent(trackId)}`);
    return data.track;
  }

  /**
   * Ask the phone to resolve a track. Returns a stream path on the phone;
   * the actual audio URL never leaves the phone.
   */
  async resolve(trackId: string): Promise<ResolvedStream> {
    return this.request<ResolvedStream>('/api/resolve', {
      method: 'POST',
      body: { trackId },
      timeoutMs: 70_000,
    });
  }

  /** Report this player's own state so the phone can show what the web is playing. */
  async reportState(report: {
    track: RemoteTrack | null;
    queue: RemoteTrack[];
    queueIndex: number;
    playing: boolean;
    positionMs: number;
  }): Promise<void> {
    await this.request('/api/state', { method: 'POST', body: report, timeoutMs: 8_000 });
  }

  /**
   * Absolute URL for an <audio> element. Media elements cannot send an
   * Authorization header, so the session token rides as `?t=`; the stream
   * path itself is a random, expiring capability bound to this session.
   */
  streamUrl(streamPath: string): string {
    if (!this.token) throw new RemoteError('UNAUTHORIZED', 'Pair with SoundWave first.');
    const sep = streamPath.includes('?') ? '&' : '?';
    return `${this.base}${streamPath}${sep}t=${encodeURIComponent(this.token)}`;
  }

  private async request<T>(
    path: string,
    opts: { method?: string; body?: unknown; timeoutMs?: number; auth?: boolean } = {},
  ): Promise<T> {
    const { method = 'GET', body, timeoutMs = 20_000, auth = true } = opts;
    const headers: Record<string, string> = {};
    if (auth && this.token) headers['Authorization'] = `Bearer ${this.token}`;
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(`${this.base}${path}`, {
        method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (e) {
      throw this.networkError(e);
    } finally {
      clearTimeout(timer);
    }

    let data: unknown = null;
    try {
      data = await resp.json();
    } catch {
      /* empty or non-JSON body */
    }
    if (!resp.ok) {
      const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
      throw new RemoteError(
        err?.code ?? `HTTP_${resp.status}`,
        err?.message ?? `SoundWave returned an error (${resp.status}).`,
        resp.status,
      );
    }
    return data as T;
  }

  private networkError(cause: unknown): RemoteError {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      return new RemoteError('TIMEOUT', 'SoundWave took too long to answer. Check the connection and retry.');
    }
    // The most common failure from this HTTPS page is an http:// tunnel-less
    // LAN address, which browsers block as mixed content. Say so plainly.
    const pageIsHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    if (pageIsHttps && this.base.startsWith('http://')) {
      return new RemoteError(
        'MIXED_CONTENT',
        'Your browser blocked this address: this secure (https) page cannot call a plain http:// ' +
          'phone address. Use the tunnel https:// address from SoundWave, or open the LAN player ' +
          'page SoundWave itself serves at that address.',
      );
    }
    return new RemoteError(
      'NETWORK',
      `Could not reach SoundWave at ${this.base || '(no address)'}. Check the address, that the ` +
        'bridge is on, and that the tunnel is connected — then retry.',
    );
  }
}

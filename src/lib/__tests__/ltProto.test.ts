import { describe, expect, it } from 'vitest';
import {
  decodeEnvelope,
  decodeMessage,
  encodeEnvelope,
  encodeMessage,
  looksLikeJson,
  PlaybackActionSchema,
  RoomStateSchema,
  SyncStateSchema,
  TrackInfoSchema,
  type LTPlaybackAction,
  type LTRoomState,
} from '../ltProto';

const track = {
  id: 'abc|artist',
  title: 'abc',
  artist: 'artist',
  album: 'album',
  duration: 214000,
  thumbnail: 'https://x/y.jpg',
  suggestedBy: 'me',
};

describe('ltProto envelope', () => {
  it('encodes a payload-less ping to the exact bytes the live server accepted', () => {
    const bytes = encodeEnvelope('ping');
    // tag(1, LEN)=0x0A, len=4, "ping"
    expect(Array.from(bytes)).toEqual([0x0a, 0x04, 0x70, 0x69, 0x6e, 0x67]);
  });

  it('round-trips type + payload', () => {
    const payload = encodeMessage({ username: 'ana' }, [{ num: 1, name: 'username', kind: 'string' }]);
    const env = decodeEnvelope(encodeEnvelope('create_room', payload));
    expect(env.type).toBe('create_room');
    expect(new TextDecoder().decode(env.payload)).toContain('ana');
    expect(env.compressed).toBe(false);
  });

  it('decodes the REAL pong payload observed from the public server', () => {
    // Captured live from wss://metroserverx.meowery.eu/ws in response to a protobuf ping:
    //   10 d7d2d29e9434 18 d7d2d29e9434  -> field2 & field3 varints (server time, epoch ms)
    const hex = '10d7d2d29e943418d7d2d29e9434';
    const buf = Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
    const msg = decodeMessage<{ f2: number; f3: number }>(buf, [
      { num: 2, name: 'f2', kind: 'int64' },
      { num: 3, name: 'f3', kind: 'int64' },
    ]);
    // Multi-byte varint must decode to a plausible epoch-ms timestamp (~1.79e12 in 2026).
    expect(msg.f2).toBeGreaterThan(1.7e12);
    expect(msg.f2).toBeLessThan(2.0e12);
    expect(msg.f3).toBe(msg.f2);
  });
});

describe('ltProto messages', () => {
  it('round-trips TrackInfo incl. int64 duration', () => {
    const back = decodeMessage<typeof track>(encodeMessage(track, TrackInfoSchema), TrackInfoSchema);
    expect(back).toEqual(track);
  });

  it('round-trips a playback action with embedded track, float volume, int64 position', () => {
    const action: LTPlaybackAction = {
      action: 'play',
      trackId: track.id,
      position: 43210,
      trackInfo: track,
      insertNext: false,
      volume: 0.75,
      serverTime: 1790000000000,
    };
    const back = decodeMessage<LTPlaybackAction>(
      encodeMessage(action as unknown as Record<string, unknown>, PlaybackActionSchema),
      PlaybackActionSchema,
    );
    expect(back.action).toBe('play');
    expect(back.position).toBe(43210);
    expect(back.volume).toBeCloseTo(0.75, 5);
    expect(back.serverTime).toBe(1790000000000);
    expect(back.trackInfo).toEqual(track);
  });

  it('round-trips RoomState with repeated users/queue and nested current track', () => {
    const state: LTRoomState = {
      roomCode: 'ABCD12',
      hostId: 'u1',
      users: [
        { userId: 'u1', username: 'host', isHost: true, isConnected: true },
        { userId: 'u2', username: 'web', isHost: false, isConnected: true },
      ],
      currentTrack: track,
      isPlaying: true,
      position: 12345,
      lastUpdate: 1790000000000,
      volume: 0.9,
      queue: [track, { ...track, id: 'other' }],
      allowParticipantControl: true,
    };
    const back = decodeMessage<LTRoomState>(
      encodeMessage(state as unknown as Record<string, unknown>, RoomStateSchema),
      RoomStateSchema,
    );
    expect(back.roomCode).toBe('ABCD12');
    expect(back.users).toHaveLength(2);
    expect(back.users[0].isHost).toBe(true);
    expect(back.users[1].isHost).toBe(false);
    expect(back.currentTrack).toEqual(track);
    expect(back.isPlaying).toBe(true);
    expect(back.queue).toHaveLength(2);
    expect(back.queue[1].id).toBe('other');
    expect(back.volume).toBeCloseTo(0.9, 5);
    expect(back.allowParticipantControl).toBe(true);
  });

  it('fills proto3 defaults for absent fields', () => {
    const back = decodeMessage<LTPlaybackAction>(
      encodeMessage({ action: 'pause' }, PlaybackActionSchema),
      PlaybackActionSchema,
    );
    expect(back.action).toBe('pause');
    expect(back.position).toBe(0);
    expect(back.trackInfo).toBeNull();
    expect(back.queue).toEqual([]);
  });

  it('decodes SyncState with queue and volume', () => {
    const bytes = encodeMessage(
      { currentTrack: track, isPlaying: false, position: 0, lastUpdate: 5, queue: [track], volume: 0.5 },
      SyncStateSchema,
    );
    const back = decodeMessage<{ isPlaying: boolean; volume: number; queue: unknown[] }>(
      bytes,
      SyncStateSchema,
    );
    expect(back.isPlaying).toBe(false);
    expect(back.volume).toBeCloseTo(0.5, 5);
    expect(back.queue).toHaveLength(1);
  });
});

describe('ltProto format detection', () => {
  it('detects JSON vs protobuf by first byte (mirrors MessageCodec.detectMessageFormat)', () => {
    expect(looksLikeJson(new TextEncoder().encode('{"type":"ping"}'))).toBe(true);
    expect(looksLikeJson(encodeEnvelope('ping'))).toBe(false);
  });
});

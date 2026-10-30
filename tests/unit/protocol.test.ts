import { describe, expect, it } from 'vitest';
import { decodeClientMessage } from '../../src/network/protocol/codec';
import { MAX_CHAT_LENGTH, MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION } from '../../src/network/protocol/messages';
import { categoryFor, ConnectionRateLimiter, TokenBucket } from '../../server/security/rateLimiter';
import { sanitizeChat, sanitizeDisplayName } from '../../server/security/sanitize';
import { hashPassword, verifyPassword } from '../../server/security/passwords';

describe('client message validation', () => {
  it('accepts well-formed messages', () => {
    const hello = decodeClientMessage(JSON.stringify({ type: 'connection:hello', protocol: PROTOCOL_VERSION, client: 'test' }));
    expect(hello.ok).toBe(true);
    const place = decodeClientMessage(JSON.stringify({ type: 'block:place', worldId: 'w1', seq: 1, x: -5, y: 40, z: 9, face: 2, yaw: 0, pitch: -0.5, hitY: 1 }));
    expect(place.ok).toBe(true);
  });

  it('rejects unknown types, bad fields and out-of-range coordinates', () => {
    expect(decodeClientMessage('{"type":"admin:give-everything"}').ok).toBe(false);
    expect(decodeClientMessage('not json').ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ type: 'block:break', worldId: 'w', seq: 1, x: 0, y: 128, z: 0 })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ type: 'block:break', worldId: 'w', seq: 1, x: 0.5, y: 3, z: 0 })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ type: 'block:place', worldId: 'w', seq: 1, x: 0, y: 3, z: 0, face: 9, yaw: 0, pitch: 0, hitY: 0 })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ type: 'inventory:select', worldId: 'w', slot: 9 })).ok).toBe(false);
  });

  it('limits chat length, input batches and payload size', () => {
    expect(decodeClientMessage(JSON.stringify({ type: 'chat:send', worldId: 'w', text: 'x'.repeat(MAX_CHAT_LENGTH + 1) })).ok).toBe(false);
    const input = { seq: 1, forward: 1, strafe: 0, jump: false, sprint: false, crouch: false, fly: false, yaw: 0, pitch: 0 };
    expect(decodeClientMessage(JSON.stringify({ type: 'player:input', worldId: 'w', inputs: Array(21).fill(input) })).ok).toBe(false);
    expect(decodeClientMessage(JSON.stringify({ type: 'player:input', worldId: 'w', inputs: [{ ...input, forward: 5 }] })).ok).toBe(false);
    expect(decodeClientMessage(' '.repeat(MAX_CLIENT_MESSAGE_BYTES + 1)).ok).toBe(false);
  });
});

describe('security helpers', () => {
  it('rate limits with token buckets', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 4, () => now);
    expect([1, 2, 3, 4, 5].map(() => bucket.tryTake())).toEqual([true, true, true, true, false]);
    now += 1000;
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(true);
    expect(bucket.tryTake()).toBe(false);
  });

  it('limits chat spam per connection', () => {
    let now = 0;
    const limiter = new ConnectionRateLimiter(() => now);
    const results = Array.from({ length: 8 }, () => limiter.allow(categoryFor('chat:send')));
    expect(results.filter(Boolean).length).toBe(5);
    now += 3000;
    expect(limiter.allow('chat')).toBe(true);
  });

  it('sanitizes names and chat', () => {
    expect(sanitizeDisplayName('  Player   One ')).toBe('Player One');
    expect(sanitizeDisplayName('<script>')).toBeNull();
    expect(sanitizeDisplayName('a')).toBeNull();
    expect(sanitizeChat('hi\u0000‮ there\n', 200)).toBe('hi there');
  });

  it('hashes and verifies world passwords', async () => {
    const hash = await hashPassword('secret');
    expect(hash).not.toContain('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
});

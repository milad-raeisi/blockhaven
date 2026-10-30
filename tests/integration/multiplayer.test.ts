import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { B } from '../../src/game/blocks/ids';
import { getBlock } from '../../src/game/blocks/registry';
import { Face } from '../../src/game/world/constants';
import { toChunkCoord } from '../../src/game/world/coords';
import type { WorldRoom } from '../../server/rooms/WorldRoom';
import { createPlayer, createWorld, sleep, startServer, TestClient, type TestServer } from './helpers';

/**
 * Find a solid block near the player with free space above it, so a block can
 * be placed on its top face within reach regardless of the terrain.
 */
function findSpot(room: WorldRoom, px: number, py: number, pz: number, exclude: string[] = []): { x: number; y: number; z: number } {
  const offsets = [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2], [2, -2], [-2, 2], [3, 0], [0, 3]];
  for (const [dx, dz] of offsets) {
    const x = Math.floor(px) + dx;
    const z = Math.floor(pz) + dz;
    if (exclude.includes(`${x},${z}`)) continue;
    for (let y = Math.floor(py) + 1; y >= Math.floor(py) - 4; y--) {
      const id = room.world.getBlock(x, y, z);
      const above = room.world.getBlock(x, y + 1, z);
      if (id !== 255 && getBlock(id).solid && getBlock(id).occludes && above !== 255 && getBlock(above).replaceable) return { x, y, z };
    }
  }
  throw new Error('No placement spot found near the player');
}

describe('multiplayer over real WebSockets', () => {
  let server: TestServer;
  let one: { cookie: string; id: string };
  let two: { cookie: string; id: string };
  let worldId: string;
  let a: TestClient;
  let b: TestClient;
  let room: WorldRoom;
  const usedSpots: string[] = [];

  beforeAll(async () => {
    server = await startServer();
    one = await createPlayer(server.baseUrl, 'Player One');
    two = await createPlayer(server.baseUrl, 'Player Two');
    worldId = (await createWorld(server.baseUrl, one.cookie, { name: 'Creative World' })).id;
  });

  afterAll(async () => {
    await a?.close();
    await b?.close();
    await server.stop();
  });

  it('rejects WebSocket connections without a session', async () => {
    const ws = new WebSocket(server.wsUrl);
    const status = await new Promise<number>((resolve) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.once('open', () => resolve(101));
    });
    expect(status).toBe(401);
  });

  it('rejects WebSocket connections from a foreign origin', async () => {
    const ws = new WebSocket(server.wsUrl, { headers: { Cookie: one.cookie, Origin: 'http://evil.example' } });
    const status = await new Promise<number>((resolve) => {
      ws.once('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.once('open', () => resolve(101));
    });
    expect(status).toBe(403);
  });

  it('lets two players join the same world and see each other', async () => {
    a = await TestClient.connect(server.wsUrl, one.cookie);
    const metaA = await a.join(worldId);
    expect(metaA.world.name).toBe('Creative World');
    expect(metaA.self.isOwner).toBe(true);
    room = server.game.rooms.loadedRooms.find((r) => r.id === worldId)!;
    expect(room).toBeDefined();

    const joined = a.waitFor('player:join', (m) => m.player.id === two.id);
    b = await TestClient.connect(server.wsUrl, two.cookie);
    const metaB = await b.join(worldId);
    expect(metaB.players.map((p) => p.name).sort()).toEqual(['Player One', 'Player Two']);
    expect((await joined).player.name).toBe('Player Two');

    // Each player receives snapshots containing the other.
    await b.waitFor('player:snapshot', (m) => m.players.some((p) => p[0] === one.id));
    await a.waitFor('player:snapshot', (m) => m.players.some((p) => p[0] === two.id));
  });

  it('synchronizes movement to the other player', async () => {
    const start = room.players.get(one.id)!.physics;
    const startX = start.x;
    const startZ = start.z;
    // Fly up first (Creative) so terrain around spawn cannot block the path.
    a.sendInputs(15, { fly: true, jump: true });
    a.sendInputs(15, { fly: true, forward: 1, yaw: 0 });
    const moved = await b.waitFor(
      'player:snapshot',
      (m) => {
        const p = m.players.find((s) => s[0] === one.id);
        return !!p && Math.hypot(p[1] - startX, p[3] - startZ) > 1;
      },
      { timeout: 10_000 },
    );
    expect(moved.players.find((s) => s[0] === one.id)).toBeDefined();
    // Server acknowledges processed inputs for reconciliation.
    const state = await a.waitFor('player:state', (m) => m.ackSeq >= 30, { timeout: 10_000 });
    expect(state.ackSeq).toBe(30);
  });

  it('synchronizes block placement and removal', async () => {
    // Land again so placements happen at ground level near the player.
    a.sendInputs(40, { fly: false });
    await a.waitFor('player:state', (m) => m.ackSeq >= 70 && (m.flags & 1) === 1, { timeout: 10_000 });
    const p = room.players.get(one.id)!.physics;
    // Bring Player Two next to Player One (both must be within reach).
    room.teleport(room.players.get(two.id)!, p.x, p.y, p.z);
    const { x, y, z } = findSpot(room, p.x, p.y, p.z);
    usedSpots.push(`${x},${z}`);
    const chunk: [number, number] = [toChunkCoord(x), toChunkCoord(z)];
    await a.requestChunks([chunk]);
    await b.requestChunks([chunk]);

    // Player One places a block on top of the ground.
    const seenByB = b.waitFor('block:update', (m) => m.changes.some((c) => c[0] === x && c[1] === y + 1 && c[2] === z && c[3] !== 0));
    const ack = a.waitFor('block:action-result', (m) => m.seq === 1);
    a.send({ type: 'inventory:select', worldId, slot: 1 });
    a.send({ type: 'block:place', worldId, seq: 1, x, y, z, face: Face.Up, yaw: 0, pitch: -1, hitY: 1 });
    const placed = await ack;
    expect(placed.reason ?? 'ok').toBe('ok');
    const update = await seenByB;
    expect(update.changes.find((c) => c[0] === x && c[1] === y + 1)![3]).toBe(B.STONE_BRICKS);
    expect(room.world.getBlock(x, y + 1, z)).toBe(B.STONE_BRICKS);

    // Player Two breaks it again.
    const seenByA = a.waitFor('block:update', (m) => m.changes.some((c) => c[0] === x && c[1] === y + 1 && c[2] === z && c[3] === 0));
    const ackB = b.waitFor('block:action-result', (m) => m.seq === 1);
    b.send({ type: 'block:break', worldId, seq: 1, x, y: y + 1, z });
    expect((await ackB).reason ?? 'ok').toBe('ok');
    await seenByA;
    expect(room.world.getBlock(x, y + 1, z)).toBe(B.AIR);
  });

  it('resolves concurrent edits of the same position consistently', async () => {
    const p = room.players.get(one.id)!.physics;
    const { x, y, z } = findSpot(room, p.x, p.y, p.z, usedSpots);
    await a.requestChunks([[toChunkCoord(x), toChunkCoord(z)]]);
    await b.requestChunks([[toChunkCoord(x), toChunkCoord(z)]]);
    b.send({ type: 'inventory:select', worldId, slot: 2 });
    await sleep(100);

    const resultA = a.waitFor('block:action-result', (m) => m.seq === 2);
    const resultB = b.waitFor('block:action-result', (m) => m.seq === 2);
    a.send({ type: 'block:place', worldId, seq: 2, x, y, z, face: Face.Up, yaw: 0, pitch: -1, hitY: 1 });
    b.send({ type: 'block:place', worldId, seq: 2, x, y, z, face: Face.Up, yaw: 0, pitch: -1, hitY: 1 });
    const [ra, rb] = await Promise.all([resultA, resultB]);
    // Exactly one wins; the loser receives the authoritative block as a correction.
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const loser = ra.ok ? rb : ra;
    const finalId = room.world.getBlock(x, y + 1, z);
    expect(loser.corrections?.find((c) => c[0] === x && c[1] === y + 1 && c[2] === z)?.[3]).toBe(finalId);
    expect([B.STONE_BRICKS, B.PLANKS]).toContain(finalId);
  });

  it('delivers chat to players in the same world only', async () => {
    const c = await createPlayer(server.baseUrl, 'Outsider');
    const otherWorld = await createWorld(server.baseUrl, c.cookie, { name: 'Other World' });
    const outsider = await TestClient.connect(server.wsUrl, c.cookie);
    await outsider.join(otherWorld.id);

    const got = b.waitFor('chat:message', (m) => m.kind === 'player' && m.text === 'Hello <b>builders</b>!');
    a.send({ type: 'chat:send', worldId, text: 'Hello <b>builders</b>!' });
    const msg = await got;
    expect(msg.fromName).toBe('Player One');
    await sleep(200);
    expect(outsider.received('chat:message', (m) => m.kind === 'player')).toHaveLength(0);

    // Room isolation: a message addressed to another world is rejected.
    const error = outsider.waitFor('connection:error');
    outsider.send({ type: 'chat:send', worldId, text: 'sneaky' });
    expect((await error).message).toMatch(/different world/);
    await outsider.close();
  });

  it('rejects malformed and oversized messages', async () => {
    const error = a.waitFor('connection:error', (m) => m.code === 'invalid_message');
    a.sendRaw(JSON.stringify({ type: 'block:place', worldId, seq: 1, x: 'nope' }));
    expect((await error).code).toBe('invalid_message');
    const error2 = a.waitFor('connection:error', (m) => m.code === 'invalid_message');
    a.send({ type: 'block:break', worldId, seq: 9, x: 0, y: 500, z: 0 } as never);
    await error2;
  });

  it('notifies others on disconnect and restores state on reconnect', async () => {
    const left = a.waitFor('player:leave', (m) => m.playerId === two.id);
    await b.close();
    await left;
    expect(room.players.has(two.id)).toBe(false);

    const rejoined = a.waitFor('player:join', (m) => m.player.id === two.id);
    b = await TestClient.connect(server.wsUrl, two.cookie);
    const meta = await b.join(worldId);
    await rejoined;
    expect(meta.inventory.selectedSlot).toBe(2);
    expect(meta.players).toHaveLength(2);
  });

  it('enforces world passwords', async () => {
    const locked = await createWorld(server.baseUrl, one.cookie, { name: 'Locked', password: 'secret' });
    const client = await TestClient.connect(server.wsUrl, two.cookie);
    const error = client.waitFor('connection:error');
    client.send({ type: 'world:join', worldId: locked.id, renderDistance: 2, password: 'wrong' });
    expect((await error).code).toBe('wrong_password');
    const meta = await client.join(locked.id, 'secret');
    expect(meta.world.name).toBe('Locked');
    await client.close();
  });
});

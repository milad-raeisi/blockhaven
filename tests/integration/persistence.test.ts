import { describe, expect, it } from 'vitest';
import { B } from '../../src/game/blocks/ids';
import { decodeDelta } from '../../src/game/chunks/delta';
import { base64ToBytes } from '../../src/game/chunks/delta';
import { getBlock } from '../../src/game/blocks/registry';
import { Face } from '../../src/game/world/constants';
import { localIndex, toChunkCoord } from '../../src/game/world/coords';
import { inflateRawSync } from 'node:zlib';
import { createPlayer, createWorld, sleep, startServer, TestClient } from './helpers';

describe('world persistence', () => {
  it('restores blocks, player position and inventory after a server restart', async () => {
    // --- First server run ---------------------------------------------------
    let server = await startServer();
    const owner = await createPlayer(server.baseUrl, 'Builder');
    const world = await createWorld(server.baseUrl, owner.cookie, { name: 'Persistent World', gameMode: 'creative' });
    let client = await TestClient.connect(server.wsUrl, owner.cookie);
    await client.join(world.id);
    const room = server.game.rooms.loadedRooms.find((r) => r.id === world.id)!;
    const player = room.players.get(owner.id)!;

    // Find ground next to the player and build a small tower of bricks.
    const px = Math.floor(player.physics.x);
    const pz = Math.floor(player.physics.z);
    const x = px + 2;
    const z = pz;
    let y = Math.floor(player.physics.y) + 1;
    while (y > 1 && !getBlock(room.world.getBlock(x, y, z)).occludes) y--;
    await client.requestChunks([[toChunkCoord(x), toChunkCoord(z)]]);
    client.send({ type: 'inventory:creative-set', worldId: world.id, slot: 4, item: B.BRICKS, count: 64 });
    client.send({ type: 'inventory:select', worldId: world.id, slot: 4 });
    for (let i = 0; i < 3; i++) {
      const ack = client.waitFor('block:action-result', (m) => m.seq === i + 1);
      client.send({ type: 'block:place', worldId: world.id, seq: i + 1, x, y: y + i, z, face: Face.Up, yaw: 0, pitch: -1, hitY: 1 });
      expect((await ack).reason ?? 'ok').toBe('ok');
    }
    // Move the player a bit (flying, Creative) so the saved position differs from spawn.
    client.sendInputs(10, { fly: true, jump: true });
    await client.waitFor('player:state', (m) => m.ackSeq >= 10);
    const savedY = player.physics.y;
    await client.close();
    await sleep(100);
    await server.stop();

    // --- Second server run (fresh process state, same database) -------------
    server = await startServer();
    client = await TestClient.connect(server.wsUrl, owner.cookie);
    const meta = await client.join(world.id);
    expect(meta.self.y).toBeCloseTo(savedY, 1);
    expect(meta.inventory.selectedSlot).toBe(4);
    expect(meta.inventory.slots[4]).toEqual({ id: B.BRICKS, count: 64 });

    const chunk = client.waitFor('world:chunk-data', (m) => m.cx === toChunkCoord(x) && m.cz === toChunkCoord(z));
    client.send({ type: 'world:chunk-request', worldId: world.id, chunks: [[toChunkCoord(x), toChunkCoord(z), -1]] });
    const data = await chunk;
    expect(data.revision).toBeGreaterThanOrEqual(3);
    const bytes = base64ToBytes(data.data);
    const delta = decodeDelta(data.encoding === 'deflate' ? new Uint8Array(inflateRawSync(bytes)) : bytes);
    for (let i = 0; i < 3; i++) {
      const packed = delta.get(localIndex(x & 15, y + 1 + i, z & 15));
      expect(packed !== undefined ? packed >> 8 : -1).toBe(B.BRICKS);
    }
    const restoredRoom = server.game.rooms.loadedRooms.find((r) => r.id === world.id)!;
    expect(restoredRoom.world.getBlock(x, y + 3, z)).toBe(B.BRICKS);

    // A client that already has the current revision gets an "unchanged" reply.
    const again = client.waitFor('world:chunk-data', (m) => m.cx === toChunkCoord(x) && m.cz === toChunkCoord(z));
    client.send({ type: 'world:chunk-request', worldId: world.id, chunks: [[toChunkCoord(x), toChunkCoord(z), data.revision]] });
    expect((await again).encoding).toBe('unchanged');

    await client.close();
    await server.stop();
  });
});

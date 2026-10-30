import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { B } from '../../src/game/blocks/ids';
import { isActive } from '../../src/game/blocks/meta';
import { toChunkCoord } from '../../src/game/world/coords';
import type { WorldRoom } from '../../server/rooms/WorldRoom';
import { createPlayer, createWorld, sleep, startServer, TestClient, type TestServer } from './helpers';

/** Wait until a predicate on the authoritative world holds. */
async function until(check: () => boolean, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('Condition not met in time');
    await sleep(50);
  }
}

describe('shared mechanisms', () => {
  let server: TestServer;
  let a: TestClient;
  let b: TestClient;
  let room: WorldRoom;
  let origin: { x: number; y: number; z: number };

  beforeAll(async () => {
    server = await startServer();
    const one = await createPlayer(server.baseUrl, 'Mechanic One');
    const two = await createPlayer(server.baseUrl, 'Mechanic Two');
    const world = await createWorld(server.baseUrl, one.cookie, { name: 'Showcase World', includeShowcase: true });
    a = await TestClient.connect(server.wsUrl, one.cookie);
    await a.join(world.id);
    b = await TestClient.connect(server.wsUrl, two.cookie);
    await b.join(world.id);
    room = server.game.rooms.loadedRooms.find((r) => r.id === world.id)!;
    // Showcase origin as placed by the room (spawn + 3, spawn + 14).
    const ox = Math.floor(room.spawn.x) + 3;
    const oz = Math.floor(room.spawn.z) + 14;
    origin = { x: ox, y: room.world.generator.getColumn(ox, oz).height, z: oz };
    // Both players stand in front of the garage.
    for (const id of [one.id, two.id]) room.teleport(room.players.get(id)!, ox - 1.5, origin.y + 1, oz - 5.5);
    const chunks: [number, number][] = [];
    for (let cx = toChunkCoord(ox - 6); cx <= toChunkCoord(ox + 23); cx++) {
      for (let cz = toChunkCoord(oz - 11); cz <= toChunkCoord(oz + 10); cz++) chunks.push([cx, cz]);
    }
    await a.requestChunks(chunks);
    await b.requestChunks(chunks);
  });

  afterAll(async () => {
    await a?.close();
    await b?.close();
    await server.stop();
  });

  const doorClosed = () => [1, 2, 3].every((dy) => [1, 2, 3, 4].every((dx) => room.world.getBlock(origin.x + dx, origin.y + dy, origin.z) === B.IRON_PANEL));
  const doorOpen = () =>
    [1, 2, 3].every((dy) => [1, 2, 3, 4].every((dx) => room.world.getBlock(origin.x + dx, origin.y + dy, origin.z) === B.AIR)) &&
    [4, 5, 6].every((dy) => room.world.getBlock(origin.x + 1, origin.y + dy, origin.z) === B.IRON_PANEL);

  it('closes the piston garage door through the inverter on load', async () => {
    await until(doorClosed);
  });

  it('opens the garage when one player flips the lever and the other sees it', async () => {
    const lever = { x: origin.x - 3, y: origin.y + 1, z: origin.z - 7 };
    expect(room.world.getBlock(lever.x, lever.y, lever.z)).toBe(B.LEVER);

    // Player Two should observe the door panels being pulled up via circuit updates.
    const seenByB = b.waitFor(
      'circuit:state-update',
      (m) => m.changes.some(([x, y, z, id]) => x === origin.x + 1 && y === origin.y + 6 && z === origin.z && id === B.IRON_PANEL),
      { timeout: 10_000 },
    );
    const ack = a.waitFor('block:action-result', (m) => m.seq === 1);
    a.send({ type: 'block:interact', worldId: room.id, seq: 1, ...lever, face: 2, sneak: false });
    expect((await ack).reason ?? 'ok').toBe('ok');
    expect(isActive(room.world.getMeta(lever.x, lever.y, lever.z))).toBe(true);
    await seenByB;
    await until(doorOpen);
  });

  it('closes again when the other player flips the lever back', async () => {
    const lever = { x: origin.x - 3, y: origin.y + 1, z: origin.z - 7 };
    const ack = b.waitFor('block:action-result', (m) => m.seq === 1);
    b.send({ type: 'block:interact', worldId: room.id, seq: 1, ...lever, face: 2, sneak: false });
    expect((await ack).reason ?? 'ok').toBe('ok');
    await until(doorClosed);
  });

  it('keeps the mechanism state consistent after save and reload', async () => {
    await room.save();
    await server.game.rooms.unloadWorld(room.id, 'test reload');
    const meta = await a.join(room.id);
    expect(meta.world.id).toBe(room.id);
    const reloaded = server.game.rooms.loadedRooms.find((r) => r.id === room.id)!;
    expect(reloaded).not.toBe(room);
    room = reloaded;
    room.teleport(room.players.get(a.playerId)!, origin.x - 1.5, origin.y + 1, origin.z - 5.5);
    await sleep(1500);
    expect(doorClosed()).toBe(true);
  });
});

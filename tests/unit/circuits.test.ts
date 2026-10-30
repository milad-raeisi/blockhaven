import { describe, expect, it } from 'vitest';
import { B } from '../../src/game/blocks/ids';
import { getWirePower, isActive, isPowered, makeMeta, withActive } from '../../src/game/blocks/meta';
import { Chunk } from '../../src/game/chunks/chunk';
import { ChunkStore } from '../../src/game/world/blockAccess';
import { Face } from '../../src/game/world/constants';
import { CircuitSimulator } from '../../server/simulation/circuits';
import { buildShowcase } from '../../server/world/showcase';

/** In-memory world with a stone floor at y = 0 and a simulator wired to it. */
function setup(radius = 2) {
  const store = new ChunkStore();
  for (let cx = -radius; cx <= radius; cx++) {
    for (let cz = -radius; cz <= radius; cz++) {
      const chunk = new Chunk(cx, cz);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) chunk.setBlock(x, 0, z, B.STONE);
      store.setChunk(chunk);
    }
  }
  const changes: [number, number, number, number, number][] = [];
  const sim: CircuitSimulator = new CircuitSimulator({
    getBlock: (x, y, z) => store.getBlock(x, y, z),
    getMeta: (x, y, z) => store.getMeta(x, y, z),
    setBlockFromCircuit: (x, y, z, id, meta) => {
      store.setBlock(x, y, z, id, meta);
      changes.push([x, y, z, id, meta]);
      sim.notifyChange(x, y, z);
      return true;
    },
  });
  const place = (x: number, y: number, z: number, id: number, meta = 0) => {
    store.setBlock(x, y, z, id, meta);
    sim.notifyChange(x, y, z);
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) sim.step();
  };
  return { store, sim, place, steps, changes };
}

describe('signal propagation', () => {
  it('powers a wire line from a lever with decaying strength and lights a lamp', () => {
    const { store, place, steps } = setup();
    place(0, 1, 0, B.LEVER, makeMeta(Face.Up));
    for (let x = 1; x <= 5; x++) place(x, 1, 0, B.WIRE);
    place(6, 1, 0, B.LAMP);
    steps(2);
    expect(getWirePower(store.getMeta(1, 1, 0))).toBe(0);
    expect(isPowered(store.getMeta(6, 1, 0))).toBe(false);

    place(0, 1, 0, B.LEVER, withActive(makeMeta(Face.Up), true));
    steps(1);
    expect(getWirePower(store.getMeta(1, 1, 0))).toBe(15);
    expect(getWirePower(store.getMeta(5, 1, 0))).toBe(11);
    expect(isPowered(store.getMeta(6, 1, 0))).toBe(true);

    place(0, 1, 0, B.LEVER, makeMeta(Face.Up));
    steps(1);
    expect(getWirePower(store.getMeta(3, 1, 0))).toBe(0);
    expect(isPowered(store.getMeta(6, 1, 0))).toBe(false);
  });

  it('signals fade out after 15 wires', () => {
    const { store, place, steps } = setup();
    place(0, 1, 0, B.SWITCH, withActive(0, true));
    for (let x = 1; x <= 18; x++) place(x, 1, 0, B.WIRE);
    steps(1);
    expect(getWirePower(store.getMeta(15, 1, 0))).toBe(1);
    expect(getWirePower(store.getMeta(16, 1, 0))).toBe(0);
  });

  it('repeaters delay and regenerate the signal; inverters invert it', () => {
    const { store, place, steps } = setup();
    place(0, 1, 0, B.SWITCH);
    place(1, 1, 0, B.REPEATER, makeMeta(Face.East, 1)); // delay (1+1)*2 = 4 ticks
    place(2, 1, 0, B.LAMP);
    place(0, 1, 2, B.SWITCH);
    place(1, 1, 2, B.INVERTER, makeMeta(Face.East));
    place(2, 1, 2, B.LAMP);
    steps(5);
    expect(isPowered(store.getMeta(2, 1, 0))).toBe(false);
    expect(isPowered(store.getMeta(2, 1, 2))).toBe(true); // inverter output is on without input

    place(0, 1, 0, B.SWITCH, withActive(0, true));
    place(0, 1, 2, B.SWITCH, withActive(0, true));
    steps(3);
    expect(isPowered(store.getMeta(2, 1, 0))).toBe(false); // still waiting for the delay
    steps(2);
    expect(isPowered(store.getMeta(2, 1, 0))).toBe(true);
    expect(isPowered(store.getMeta(2, 1, 2))).toBe(false);
  });

  it('implements AND and OR gates from their side inputs', () => {
    const { store, place, steps } = setup();
    // Gates face east; their side inputs are north (z-1) and south (z+1).
    place(5, 1, 0, B.AND_GATE, makeMeta(Face.East));
    place(6, 1, 0, B.LAMP);
    place(5, 1, -1, B.SWITCH);
    place(5, 1, 1, B.SWITCH);
    place(5, 1, 5, B.OR_GATE, makeMeta(Face.East));
    place(6, 1, 5, B.LAMP);
    place(5, 1, 4, B.SWITCH);
    place(5, 1, 6, B.SWITCH);
    steps(4);
    expect(isPowered(store.getMeta(6, 1, 0))).toBe(false);
    expect(isPowered(store.getMeta(6, 1, 5))).toBe(false);

    place(5, 1, -1, B.SWITCH, withActive(0, true));
    place(5, 1, 4, B.SWITCH, withActive(0, true));
    steps(4);
    expect(isPowered(store.getMeta(6, 1, 0))).toBe(false);
    expect(isPowered(store.getMeta(6, 1, 5))).toBe(true);

    place(5, 1, 1, B.SWITCH, withActive(0, true));
    steps(4);
    expect(isPowered(store.getMeta(6, 1, 0))).toBe(true);
  });

  it('timers pulse attached lamps', () => {
    const { store, place, steps } = setup();
    place(0, 1, 0, B.TIMER, makeMeta(0, 0)); // toggles every 5 ticks
    place(1, 1, 0, B.LAMP);
    const states: boolean[] = [];
    for (let i = 0; i < 30; i++) {
      steps(1);
      states.push(isPowered(store.getMeta(1, 1, 0)));
    }
    expect(states.filter(Boolean).length).toBeGreaterThan(5);
    expect(states.filter((s) => !s).length).toBeGreaterThan(5);
  });

  it('opens doors from pressure plates', () => {
    const { store, place, steps } = setup();
    place(0, 1, 0, B.DOOR, makeMeta(Face.South, 0));
    place(0, 2, 0, B.DOOR, makeMeta(Face.South, 1));
    place(0, 1, -1, B.PRESSURE_PLATE);
    steps(1);
    expect(isActive(store.getMeta(0, 1, 0))).toBe(false);
    place(0, 1, -1, B.PRESSURE_PLATE, withActive(0, true));
    steps(1);
    expect(isActive(store.getMeta(0, 1, 0))).toBe(true);
    expect(isActive(store.getMeta(0, 2, 0))).toBe(true);
  });

  it('keeps feedback clocks oscillating with a bounded event queue', () => {
    const { store, place, steps, sim } = setup();
    // An inverter feeding itself through wires oscillates every gate delay.
    place(0, 1, 0, B.INVERTER, makeMeta(Face.East));
    place(1, 1, 0, B.WIRE);
    place(1, 1, 1, B.WIRE);
    place(0, 1, 1, B.WIRE);
    place(-1, 1, 1, B.WIRE);
    place(-1, 1, 0, B.WIRE);
    let toggles = 0;
    let last = isPowered(store.getMeta(0, 1, 0));
    for (let i = 0; i < 400; i++) {
      steps(1);
      const now = isPowered(store.getMeta(0, 1, 0));
      if (now !== last) toggles++;
      last = now;
      expect(sim.pendingEvents).toBeLessThan(10);
    }
    expect(toggles).toBeGreaterThan(50);
  });
});

describe('pistons', () => {
  it('pushes a block line and the sticky piston pulls it back', () => {
    const { store, place, steps } = setup();
    place(0, 1, 0, B.STICKY_PISTON, makeMeta(Face.East, 0));
    place(1, 1, 0, B.BRICKS);
    place(2, 1, 0, B.BRICKS);
    place(-1, 1, 0, B.SWITCH, withActive(0, true));
    steps(4);
    expect(store.getBlock(1, 1, 0)).toBe(B.PISTON_ARM);
    expect(store.getBlock(2, 1, 0)).toBe(B.BRICKS);
    expect(store.getBlock(3, 1, 0)).toBe(B.BRICKS);

    place(-1, 1, 0, B.SWITCH, 0);
    steps(4);
    expect(store.getBlock(1, 1, 0)).toBe(B.BRICKS);
    expect(store.getBlock(2, 1, 0)).toBe(B.BRICKS);
    expect(store.getBlock(3, 1, 0)).toBe(B.AIR);
  });

  it('refuses to push immovable blocks or lines longer than the limit', () => {
    const { store, place, steps } = setup();
    place(0, 1, 0, B.PISTON, makeMeta(Face.East, 0));
    place(1, 1, 0, B.CHEST);
    place(-1, 1, 0, B.SWITCH, withActive(0, true));
    steps(4);
    expect(store.getBlock(1, 1, 0)).toBe(B.CHEST);
    expect(isActive(store.getMeta(0, 1, 0))).toBe(false);
  });
});

describe('garage door showcase', () => {
  it('closes on load, opens with the lever and closes again', () => {
    const { store, place, steps } = setup(3);
    const oy = 0;
    for (const p of buildShowcase(0, oy, 0)) place(p.x, p.y, p.z, p.id, p.meta);
    const panelAt = (dx: number, y: number) => store.getBlock(dx, oy + y, 0) === B.IRON_PANEL;
    const closed = () => [1, 2, 3].every((y) => [1, 2, 3, 4].every((x) => panelAt(x, y)));
    const open = () => [4, 5, 6].every((y) => [1, 2, 3, 4].every((x) => panelAt(x, y))) && [1, 2, 3].every((y) => store.getBlock(1, oy + y, 0) === B.AIR);

    steps(20);
    expect(closed()).toBe(true);

    const lever = { x: -3, y: oy + 1, z: -7 };
    expect(store.getBlock(lever.x, lever.y, lever.z)).toBe(B.LEVER);
    place(lever.x, lever.y, lever.z, B.LEVER, withActive(store.getMeta(lever.x, lever.y, lever.z), true));
    steps(20);
    expect(open()).toBe(true);
    expect(isPowered(store.getMeta(-1, oy + 1, -7))).toBe(true); // status lamp

    place(lever.x, lever.y, lever.z, B.LEVER, withActive(store.getMeta(lever.x, lever.y, lever.z), false));
    steps(20);
    expect(closed()).toBe(true);
  });
});

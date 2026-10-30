import { B } from '../../src/game/blocks/ids';
import {
  getFacing,
  getVariant,
  getWirePower,
  isActive,
  isPowered,
  makeMeta,
  withActive,
  withPowered,
  withVariant,
  withWirePower,
} from '../../src/game/blocks/meta';
import { getBlock, type CircuitRole } from '../../src/game/blocks/registry';
import type { Chunk } from '../../src/game/chunks/chunk';
import { UNLOADED, type BlockAccess } from '../../src/game/world/blockAccess';
import { FACE_DIRS, HORIZONTAL_FACES, OPPOSITE_FACE, WORLD_HEIGHT } from '../../src/game/world/constants';
import { indexToLocal } from '../../src/game/world/coords';

export interface CircuitWorld extends BlockAccess {
  /** Apply a block change caused by the simulation. Returns false if it could not be applied. */
  setBlockFromCircuit(x: number, y: number, z: number, id: number, meta: number): boolean;
}

type EventKind = 'gate' | 'piston' | 'timer' | 'release';

interface ScheduledEvent {
  kind: EventKind;
  x: number;
  y: number;
  z: number;
}

export const MAX_PUSH = 12;
export const BUTTON_PULSE_TICKS = 30;
const GATE_DELAY = 2;
const PISTON_DELAY = 2;
const EVAL_BUDGET = 4096;
const EVENT_BUDGET = 2048;
const MAX_WIRE_NETWORK = 2048;
const BURNOUT_WINDOW = 20;
const BURNOUT_LIMIT = 24;
const BURNOUT_TICKS = 100;

export function repeaterDelay(meta: number): number {
  return (getVariant(meta) + 1) * 2;
}

export function timerHalfPeriod(meta: number): number {
  return (getVariant(meta) + 1) * 5;
}

export function pistonStroke(meta: number): number {
  return Math.min(3, getVariant(meta) + 1);
}

const posKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

function rightOf(face: number): number {
  const i = HORIZONTAL_FACES.indexOf(face as (typeof HORIZONTAL_FACES)[number]);
  return i < 0 ? face : HORIZONTAL_FACES[(i + 1) % 4];
}

function leftOf(face: number): number {
  const i = HORIZONTAL_FACES.indexOf(face as (typeof HORIZONTAL_FACES)[number]);
  return i < 0 ? face : HORIZONTAL_FACES[(i + 3) % 4];
}

const SOLID_CUBE = (id: number) => id !== UNLOADED && getBlock(id).occludes;

/**
 * Deterministic, server-side signal simulation.
 *
 * Wires propagate instantly (strength 15, -1 per wire). Gates, repeaters and
 * pistons react through a tick-ordered event queue, which breaks feedback
 * loops into discrete steps. Per-tick budgets and a burnout guard keep runaway
 * circuits from overloading the server.
 */
export class CircuitSimulator {
  private tick = 0;
  private dirty = new Set<string>();
  private readonly queue = new Map<number, ScheduledEvent[]>();
  private readonly scheduled = new Set<string>();
  private readonly toggles = new Map<string, number>();
  private readonly burnt = new Map<string, number>();
  private wiresDone = new Set<string>();
  /** Reported when a position is temporarily disabled for toggling too fast. */
  onBurnout: ((x: number, y: number, z: number) => void) | null = null;

  constructor(private readonly world: CircuitWorld) {}

  get currentTick(): number {
    return this.tick;
  }

  get pendingEvents(): number {
    let n = 0;
    for (const list of this.queue.values()) n += list.length;
    return n;
  }

  markDirty(x: number, y: number, z: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    this.dirty.add(posKey(x, y, z));
  }

  /** Called for every block change: re-evaluate the block and its neighbours. */
  notifyChange(x: number, y: number, z: number): void {
    this.markDirty(x, y, z);
    for (const [dx, dy, dz] of FACE_DIRS) this.markDirty(x + dx, y + dy, z + dz);
    // Wires step up/down one block diagonally.
    for (const f of HORIZONTAL_FACES) {
      const [dx, , dz] = FACE_DIRS[f];
      this.markDirty(x + dx, y + 1, z + dz);
      this.markDirty(x + dx, y - 1, z + dz);
    }
  }

  /** Mark every circuit component in a freshly generated chunk for evaluation. */
  wakeChunk(chunk: Chunk): void {
    const blocks = chunk.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const id = blocks[i];
      if (id === 0) continue;
      const role = getBlock(id).circuit;
      if (role === 'none') continue;
      const [lx, y, lz] = indexToLocal(i);
      this.markDirty(chunk.originX + lx, y, chunk.originZ + lz);
    }
  }

  schedule(x: number, y: number, z: number, delay: number, kind: EventKind): void {
    const key = `${kind}:${posKey(x, y, z)}`;
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const at = this.tick + Math.max(1, delay);
    const list = this.queue.get(at);
    if (list) list.push({ kind, x, y, z });
    else this.queue.set(at, [{ kind, x, y, z }]);
  }

  /** Advance the simulation by one tick. */
  step(): void {
    this.tick++;
    this.wiresDone = new Set();
    if (this.tick % BURNOUT_WINDOW === 0) this.toggles.clear();
    for (const [key, until] of this.burnt) if (until <= this.tick) this.burnt.delete(key);

    const events = this.queue.get(this.tick);
    if (events) {
      this.queue.delete(this.tick);
      let processed = 0;
      for (const event of events) {
        this.scheduled.delete(`${event.kind}:${posKey(event.x, event.y, event.z)}`);
        if (processed++ >= EVENT_BUDGET) {
          // Defer the remainder to keep the tick bounded.
          this.schedule(event.x, event.y, event.z, 1, event.kind);
          continue;
        }
        this.handleEvent(event);
      }
    }

    let budget = EVAL_BUDGET;
    while (this.dirty.size > 0 && budget > 0) {
      const batch = this.dirty;
      this.dirty = new Set();
      for (const key of batch) {
        if (budget-- <= 0) {
          this.dirty.add(key);
          continue;
        }
        const [x, y, z] = key.split(',').map(Number);
        this.evaluate(x, y, z);
      }
    }
  }

  // --- Power queries ----------------------------------------------------------

  /** Power the block at (x, y, z) emits toward the neighbour in direction `face`. */
  emittedPower(x: number, y: number, z: number, face: number): number {
    const id = this.world.getBlock(x, y, z);
    if (id === UNLOADED || id === B.AIR) return 0;
    const meta = this.world.getMeta(x, y, z);
    switch (getBlock(id).circuit) {
      case 'source':
      case 'timer':
        return isActive(meta) ? 15 : 0;
      case 'repeater':
      case 'inverter':
      case 'andGate':
      case 'orGate':
        return isPowered(meta) && getFacing(meta) === face ? 15 : 0;
      case 'wire':
        return getWirePower(meta);
      default:
        return 0;
    }
  }

  /** Power arriving at (x, y, z) from the neighbour on side `face`. */
  powerFrom(x: number, y: number, z: number, face: number): number {
    const [dx, dy, dz] = FACE_DIRS[face];
    return this.emittedPower(x + dx, y + dy, z + dz, OPPOSITE_FACE[face]);
  }

  inputPower(x: number, y: number, z: number, excludeFace = -1): number {
    let max = 0;
    for (let f = 0; f < 6; f++) {
      if (f === excludeFace) continue;
      const p = this.powerFrom(x, y, z, f);
      if (p > max) max = p;
    }
    return max;
  }

  // --- Evaluation ----------------------------------------------------------------

  private evaluate(x: number, y: number, z: number): void {
    const key = posKey(x, y, z);
    if (this.burnt.has(key)) return;
    const id = this.world.getBlock(x, y, z);
    if (id === UNLOADED || id === B.AIR) return;
    const role: CircuitRole = getBlock(id).circuit;
    const meta = this.world.getMeta(x, y, z);
    switch (role) {
      case 'wire':
        if (!this.wiresDone.has(key)) this.evaluateWireNetwork(x, y, z);
        break;
      case 'consumer':
        this.evaluateConsumer(x, y, z, id, meta);
        break;
      case 'repeater':
      case 'inverter':
      case 'andGate':
      case 'orGate': {
        const desired = this.gateOutput(x, y, z, role, meta);
        if (desired !== isPowered(meta)) this.schedule(x, y, z, role === 'repeater' ? repeaterDelay(meta) : GATE_DELAY, 'gate');
        break;
      }
      case 'piston': {
        const desired = this.inputPower(x, y, z, getFacing(meta)) > 0;
        if (desired !== isActive(meta)) this.schedule(x, y, z, PISTON_DELAY, 'piston');
        break;
      }
      case 'timer': {
        const blocked = this.inputPower(x, y, z) > 0;
        if (blocked) {
          if (isActive(meta)) this.setState(x, y, z, id, withActive(meta, false));
        } else {
          this.schedule(x, y, z, timerHalfPeriod(meta), 'timer');
        }
        break;
      }
      default:
        break;
    }
  }

  private gateOutput(x: number, y: number, z: number, role: CircuitRole, meta: number): boolean {
    const facing = getFacing(meta);
    const back = this.powerFrom(x, y, z, OPPOSITE_FACE[facing]) > 0;
    switch (role) {
      case 'repeater':
        return back;
      case 'inverter':
        return !back;
      case 'andGate':
        return this.powerFrom(x, y, z, leftOf(facing)) > 0 && this.powerFrom(x, y, z, rightOf(facing)) > 0;
      case 'orGate':
        return back || this.powerFrom(x, y, z, leftOf(facing)) > 0 || this.powerFrom(x, y, z, rightOf(facing)) > 0;
      default:
        return false;
    }
  }

  private evaluateConsumer(x: number, y: number, z: number, id: number, meta: number): void {
    if (id === B.DOOR) {
      const lowerY = getVariant(meta) & 1 ? y - 1 : y;
      if (this.world.getBlock(x, lowerY, z) !== B.DOOR || this.world.getBlock(x, lowerY + 1, z) !== B.DOOR) return;
      const powered = this.inputPower(x, lowerY, z) > 0 || this.inputPower(x, lowerY + 1, z) > 0;
      const lowerMeta = this.world.getMeta(x, lowerY, z);
      if (powered === isPowered(lowerMeta)) return;
      for (const yy of [lowerY, lowerY + 1]) {
        const m = this.world.getMeta(x, yy, z);
        this.setState(x, yy, z, id, withActive(withPowered(m, powered), powered));
      }
      return;
    }
    const powered = this.inputPower(x, y, z) > 0;
    if (powered === isPowered(meta)) return;
    // Doors and trapdoors follow the signal on each change; lamps just light up.
    const next = id === B.TRAPDOOR ? withActive(withPowered(meta, powered), powered) : withPowered(meta, powered);
    this.setState(x, y, z, id, next);
  }

  /** Neighbouring wires, including one-block diagonal steps up and down. */
  private wireNeighbours(x: number, y: number, z: number): [number, number, number][] {
    const result: [number, number, number][] = [];
    for (const [dx, dy, dz] of FACE_DIRS) {
      if (this.world.getBlock(x + dx, y + dy, z + dz) === B.WIRE) result.push([x + dx, y + dy, z + dz]);
    }
    const aboveSolid = SOLID_CUBE(this.world.getBlock(x, y + 1, z));
    for (const f of HORIZONTAL_FACES) {
      const [dx, , dz] = FACE_DIRS[f];
      if (!aboveSolid && this.world.getBlock(x + dx, y + 1, z + dz) === B.WIRE) result.push([x + dx, y + 1, z + dz]);
      const sideSolid = SOLID_CUBE(this.world.getBlock(x + dx, y, z + dz));
      if (!sideSolid && this.world.getBlock(x + dx, y - 1, z + dz) === B.WIRE) result.push([x + dx, y - 1, z + dz]);
    }
    return result;
  }

  private evaluateWireNetwork(sx: number, sy: number, sz: number): void {
    const network: [number, number, number][] = [];
    const index = new Map<string, number>();
    const stack: [number, number, number][] = [[sx, sy, sz]];
    index.set(posKey(sx, sy, sz), 0);
    network.push([sx, sy, sz]);
    while (stack.length && network.length < MAX_WIRE_NETWORK) {
      const [x, y, z] = stack.pop()!;
      for (const n of this.wireNeighbours(x, y, z)) {
        const k = posKey(n[0], n[1], n[2]);
        if (index.has(k)) continue;
        index.set(k, network.length);
        network.push(n);
        stack.push(n);
      }
    }

    // External power: strongest non-wire neighbour output into each wire.
    const levels = new Int8Array(network.length);
    const adjacency: number[][] = network.map(() => []);
    for (let i = 0; i < network.length; i++) {
      const [x, y, z] = network[i];
      this.wiresDone.add(posKey(x, y, z));
      let external = 0;
      for (let f = 0; f < 6; f++) {
        const [dx, dy, dz] = FACE_DIRS[f];
        const nid = this.world.getBlock(x + dx, y + dy, z + dz);
        if (nid === B.WIRE || nid === UNLOADED) continue;
        external = Math.max(external, this.emittedPower(x + dx, y + dy, z + dz, OPPOSITE_FACE[f]));
      }
      levels[i] = external;
      for (const n of this.wireNeighbours(x, y, z)) {
        const j = index.get(posKey(n[0], n[1], n[2]));
        if (j !== undefined) adjacency[i].push(j);
      }
    }

    // Propagate from strongest to weakest (bucket queue).
    const buckets: number[][] = Array.from({ length: 16 }, () => []);
    for (let i = 0; i < network.length; i++) if (levels[i] > 0) buckets[levels[i]].push(i);
    for (let level = 15; level > 1; level--) {
      for (const i of buckets[level]) {
        if (levels[i] !== level) continue;
        for (const j of adjacency[i]) {
          if (levels[j] < level - 1) {
            levels[j] = level - 1;
            buckets[level - 1].push(j);
          }
        }
      }
    }

    for (let i = 0; i < network.length; i++) {
      const [x, y, z] = network[i];
      const meta = this.world.getMeta(x, y, z);
      if (getWirePower(meta) !== levels[i]) this.world.setBlockFromCircuit(x, y, z, B.WIRE, withWirePower(meta, levels[i]));
    }
  }

  // --- Events -----------------------------------------------------------------------

  private handleEvent(event: ScheduledEvent): void {
    const { x, y, z } = event;
    const key = posKey(x, y, z);
    if (this.burnt.has(key)) return;
    const id = this.world.getBlock(x, y, z);
    if (id === UNLOADED) return;
    const meta = this.world.getMeta(x, y, z);
    const role = getBlock(id).circuit;
    switch (event.kind) {
      case 'gate': {
        if (role !== 'repeater' && role !== 'inverter' && role !== 'andGate' && role !== 'orGate') return;
        const desired = this.gateOutput(x, y, z, role, meta);
        if (desired !== isPowered(meta)) this.setState(x, y, z, id, withPowered(meta, desired));
        break;
      }
      case 'piston': {
        if (role !== 'piston') return;
        const desired = this.inputPower(x, y, z, getFacing(meta)) > 0;
        if (desired && !isActive(meta)) this.extendPiston(x, y, z, id, meta);
        else if (!desired && isActive(meta)) this.retractPiston(x, y, z, id, meta);
        break;
      }
      case 'timer': {
        if (role !== 'timer') return;
        if (this.inputPower(x, y, z) > 0) {
          if (isActive(meta)) this.setState(x, y, z, id, withActive(meta, false));
          return;
        }
        this.setState(x, y, z, id, withActive(meta, !isActive(meta)));
        this.schedule(x, y, z, timerHalfPeriod(meta), 'timer');
        break;
      }
      case 'release': {
        if ((id === B.BUTTON || id === B.PRESSURE_PLATE) && isActive(meta)) this.setState(x, y, z, id, withActive(meta, false));
        break;
      }
    }
  }

  private setState(x: number, y: number, z: number, id: number, meta: number): void {
    const key = posKey(x, y, z);
    const count = (this.toggles.get(key) ?? 0) + 1;
    this.toggles.set(key, count);
    if (count > BURNOUT_LIMIT) {
      this.burnt.set(key, this.tick + BURNOUT_TICKS);
      this.onBurnout?.(x, y, z);
      return;
    }
    this.world.setBlockFromCircuit(x, y, z, id, meta);
  }

  private isFree(id: number): boolean {
    if (id === UNLOADED) return false;
    const def = getBlock(id);
    return id === B.AIR || def.replaceable || def.pushBehavior === 'destroy';
  }

  /** Push the line of blocks in front of the piston by its stroke and place the arm. */
  extendPiston(x: number, y: number, z: number, id: number, meta: number): boolean {
    const facing = getFacing(meta);
    const [dx, dy, dz] = FACE_DIRS[facing];
    const stroke = pistonStroke(meta);
    const line: [number, number, number, number, number][] = [];
    let cx = x + dx;
    let cy = y + dy;
    let cz = z + dz;
    for (;;) {
      if (cy < 0 || cy >= WORLD_HEIGHT) return false;
      const bid = this.world.getBlock(cx, cy, cz);
      if (this.isFree(bid)) break;
      if (bid === UNLOADED || getBlock(bid).pushBehavior === 'immovable') return false;
      line.push([cx, cy, cz, bid, this.world.getMeta(cx, cy, cz)]);
      if (line.length > MAX_PUSH) return false;
      cx += dx;
      cy += dy;
      cz += dz;
    }
    // The cells the line moves into must be free.
    for (let s = 0; s < stroke; s++) {
      const tx = x + dx * (line.length + 1 + s);
      const ty = y + dy * (line.length + 1 + s);
      const tz = z + dz * (line.length + 1 + s);
      if (ty < 0 || ty >= WORLD_HEIGHT || !this.isFree(this.world.getBlock(tx, ty, tz))) return false;
    }
    for (let i = line.length - 1; i >= 0; i--) {
      const [bx, by, bz, bid, bmeta] = line[i];
      this.world.setBlockFromCircuit(bx + dx * stroke, by + dy * stroke, bz + dz * stroke, bid, bmeta);
    }
    for (let s = 1; s <= stroke; s++) {
      const head = s === stroke ? 1 : 0;
      this.world.setBlockFromCircuit(x + dx * s, y + dy * s, z + dz * s, B.PISTON_ARM, makeMeta(facing, head));
    }
    this.setState(x, y, z, id, withActive(meta, true));
    return true;
  }

  /** Remove the arm; sticky pistons pull back the attached line of matching blocks. */
  retractPiston(x: number, y: number, z: number, id: number, meta: number): void {
    const facing = getFacing(meta);
    const [dx, dy, dz] = FACE_DIRS[facing];
    const stroke = pistonStroke(meta);
    for (let s = 1; s <= stroke; s++) {
      const ax = x + dx * s;
      const ay = y + dy * s;
      const az = z + dz * s;
      if (this.world.getBlock(ax, ay, az) === B.PISTON_ARM && getFacing(this.world.getMeta(ax, ay, az)) === facing) {
        this.world.setBlockFromCircuit(ax, ay, az, B.AIR, 0);
      }
    }
    if (id === B.STICKY_PISTON) {
      const line: [number, number, number, number, number][] = [];
      let cx = x + dx * (stroke + 1);
      let cy = y + dy * (stroke + 1);
      let cz = z + dz * (stroke + 1);
      const first = this.world.getBlock(cx, cy, cz);
      if (first !== UNLOADED && first !== B.AIR && getBlock(first).pushBehavior === 'normal') {
        while (line.length < MAX_PUSH && cy >= 0 && cy < WORLD_HEIGHT && this.world.getBlock(cx, cy, cz) === first) {
          line.push([cx, cy, cz, first, this.world.getMeta(cx, cy, cz)]);
          cx += dx;
          cy += dy;
          cz += dz;
        }
        for (const [bx, by, bz, bid, bmeta] of line) {
          this.world.setBlockFromCircuit(bx - dx * stroke, by - dy * stroke, bz - dz * stroke, bid, bmeta);
          this.world.setBlockFromCircuit(bx, by, bz, B.AIR, 0);
        }
      }
    }
    this.setState(x, y, z, id, withActive(meta, false));
  }

  /** Remove the arm of a piston that is being destroyed while extended. */
  removeArm(x: number, y: number, z: number, meta: number): void {
    if (!isActive(meta)) return;
    const facing = getFacing(meta);
    const [dx, dy, dz] = FACE_DIRS[facing];
    for (let s = 1; s <= pistonStroke(meta); s++) {
      if (this.world.getBlock(x + dx * s, y + dy * s, z + dz * s) === B.PISTON_ARM) {
        this.world.setBlockFromCircuit(x + dx * s, y + dy * s, z + dz * s, B.AIR, 0);
      }
    }
  }

  /** Cycle the configurable variant (repeater delay, piston stroke, timer speed). */
  static cycleVariant(id: number, meta: number): number | null {
    const v = getVariant(meta);
    if (id === B.REPEATER) return withVariant(meta, (v + 1) % 4);
    if (id === B.TIMER) return withVariant(meta, (v + 1) % 8);
    if ((id === B.PISTON || id === B.STICKY_PISTON) && !isActive(meta)) return withVariant(meta, (v + 1) % 3);
    return null;
  }
}


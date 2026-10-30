import { B } from '../../src/game/blocks/ids';
import { makeMeta } from '../../src/game/blocks/meta';
import { Face } from '../../src/game/world/constants';

export interface Placement {
  x: number;
  y: number;
  z: number;
  id: number;
  meta: number;
}

/** Footprint of the showcase relative to its origin (inclusive bounds). */
export const SHOWCASE_BOUNDS = { minX: -5, maxX: 22, minZ: -10, maxZ: 9, height: 12 };

/**
 * Builds the mechanism showcase: a piston-driven garage door, a pressure-plate
 * entrance and a timer-driven light. Everything is made of regular blocks and
 * runs on the normal circuit simulation, so it behaves identically for every
 * player and survives save/reload.
 *
 * Layout (local coordinates, +X east, +Z south, y = 0 is the platform floor):
 *
 * Garage (x 0..5, z 0..6): the front facade at z = 0 has a 4x3 opening.
 * Four sticky pistons at y = 7 face down with a 3-block stroke. When retracted,
 * the iron-panel door rests in the slot above the opening (y 4..6); when the
 * pistons extend they push it down into the opening (y 1..3).
 *
 * Control: a lever and a button at the foot of a wired staircase (x = -2)
 * feed an OR gate and an inverter on top of the facade, so the door is closed
 * by default and opens while the lever is on (or briefly after the button).
 */
export function buildShowcase(ox: number, oy: number, oz: number): Placement[] {
  const out: Placement[] = [];
  const put = (x: number, y: number, z: number, id: number, meta = 0) => out.push({ x: ox + x, y: oy + y, z: oz + z, id, meta });

  // Platform floor and cleared air volume.
  for (let x = SHOWCASE_BOUNDS.minX; x <= SHOWCASE_BOUNDS.maxX; x++) {
    for (let z = SHOWCASE_BOUNDS.minZ; z <= SHOWCASE_BOUNDS.maxZ; z++) {
      put(x, 0, z, B.STONE_BRICKS);
      for (let y = 1; y <= SHOWCASE_BOUNDS.height; y++) put(x, y, z, B.AIR);
    }
  }

  // --- Garage ---------------------------------------------------------------
  // Side walls and back wall (interior x 1..4, z 1..5, height 3), roof at y = 4.
  for (let z = 0; z <= 6; z++) {
    for (let y = 1; y <= 8; y++) {
      if (z > 0 && y > 4) continue;
      put(0, y, z, B.STONE_BRICKS);
      put(5, y, z, B.STONE_BRICKS);
    }
  }
  for (let x = 1; x <= 4; x++) {
    for (let y = 1; y <= 3; y++) put(x, y, 6, B.STONE_BRICKS);
    for (let z = 1; z <= 6; z++) put(x, 4, z, B.STONE_BRICKS);
    // Back of the door slot so the raised door sits in a recess.
    for (let y = 5; y <= 7; y++) put(x, y, 1, B.STONE_BRICKS);
    // Door panels start retracted in the slot above the opening.
    for (let y = 4; y <= 6; y++) put(x, y, 0, B.IRON_PANEL);
    // Sticky pistons facing down, stroke 3 (variant 2).
    put(x, 7, 0, B.STICKY_PISTON, makeMeta(Face.Down, 2));
    // Signal wire on top of the pistons.
    put(x, 8, 0, B.WIRE);
  }
  // Light inside the garage.
  put(2, 3, 5, B.GLOWSTONE);

  // Logic on top of the facade: staircase wire -> OR gate -> inverter -> wire.
  put(-1, 7, 0, B.STONE_BRICKS);
  put(-1, 8, 0, B.OR_GATE, makeMeta(Face.East));
  put(0, 8, 0, B.INVERTER, makeMeta(Face.East));

  // Wired staircase rising toward the facade along x = -2.
  for (let k = 1; k <= 7; k++) {
    for (let y = 1; y <= k; y++) put(-2, y, -7 + k, B.STONE_BRICKS);
    put(-2, k + 1, -7 + k, B.WIRE);
  }
  put(-2, 1, -7, B.WIRE);
  // Controls at the foot of the staircase.
  put(-3, 1, -7, B.LEVER, makeMeta(Face.Up));
  put(-2, 1, -8, B.BUTTON, makeMeta(Face.Up));
  put(-1, 1, -7, B.LAMP);

  // --- Pressure-plate entrance --------------------------------------------------
  // A small booth with a door that opens automatically when stepped on.
  const bx = 10;
  for (let x = bx; x <= bx + 4; x++) {
    for (let z = 0; z <= 4; z++) {
      const wall = x === bx || x === bx + 4 || z === 0 || z === 4;
      for (let y = 1; y <= 3; y++) if (wall) put(x, y, z, B.PLANKS);
      put(x, 4, z, B.PLANK_SLAB);
    }
  }
  put(bx + 2, 1, 0, B.DOOR, makeMeta(Face.South, 0));
  put(bx + 2, 2, 0, B.DOOR, makeMeta(Face.South, 1));
  put(bx + 2, 1, -1, B.PRESSURE_PLATE);
  put(bx + 2, 1, 1, B.PRESSURE_PLATE);
  put(bx + 2, 3, 2, B.GLASS);

  // --- Timed lighting ---------------------------------------------------------------
  const tx = 18;
  const tz = 2;
  put(tx, 1, tz, B.TIMER, makeMeta(0, 1));
  put(tx + 1, 1, tz, B.LAMP);
  put(tx - 1, 1, tz, B.LAMP);
  put(tx, 1, tz + 1, B.LAMP);
  put(tx, 1, tz - 1, B.LAMP);
  put(tx, 2, tz, B.LAMP);

  // --- Lever-controlled lamp post -------------------------------------------------
  put(14, 1, -6, B.LEVER, makeMeta(Face.Up));
  put(15, 1, -6, B.WIRE);
  put(16, 1, -6, B.WIRE);
  put(17, 1, -6, B.LAMP);
  put(17, 2, -6, B.FENCE);
  put(17, 3, -6, B.GLASS);

  return out;
}

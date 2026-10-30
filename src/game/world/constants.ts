/** Shared world dimensions and simulation constants (used by client and server). */

export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const SEA_LEVEL = 40;

export const DEFAULT_RENDER_DISTANCE = 6;
export const MIN_RENDER_DISTANCE = 2;
export const MAX_RENDER_DISTANCE = 12;

/** Fixed physics step. Clients and the server both simulate players at this rate. */
export const PHYSICS_DT = 1 / 20;
export const PHYSICS_RATE = 20;

export const DAY_LENGTH_TICKS = 24000;
/** In-game ticks that elapse per real second (a full day lasts 20 minutes). */
export const WORLD_TICKS_PER_SECOND = 20;

export const INTERACTION_DISTANCE = 6;
/** The server allows a little slack beyond the client reach for latency. */
export const SERVER_INTERACTION_DISTANCE = 7.5;

/** Face directions indexed by face id: +X, -X, +Y, -Y, +Z, -Z. */
export const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** Face ids: +X east, -X west, +Y up, -Y down, +Z south, -Z north. */
export const Face = {
  East: 0,
  West: 1,
  Up: 2,
  Down: 3,
  South: 4,
  North: 5,
} as const;
export type FaceId = 0 | 1 | 2 | 3 | 4 | 5;

export const OPPOSITE_FACE: readonly FaceId[] = [1, 0, 3, 2, 5, 4];

/** Horizontal faces in clockwise order starting north (used for rotation). */
export const HORIZONTAL_FACES: readonly FaceId[] = [Face.North, Face.East, Face.South, Face.West];

export function isHorizontalFace(face: number): boolean {
  return face !== Face.Up && face !== Face.Down;
}

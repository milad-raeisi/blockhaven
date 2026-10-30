import { Face, type FaceId } from '../world/constants';
import { B } from './ids';
import { makeMeta } from './meta';
import { getBlock } from './registry';

/** Unit look direction for a yaw/pitch pair (yaw 0 looks toward -Z). */
export function lookDirection(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Horizontal face the player is looking toward. */
export function horizontalFacingFromYaw(yaw: number): FaceId {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? Face.East : Face.West;
  return dz > 0 ? Face.South : Face.North;
}

/** Any face (including up/down) the player is looking toward. */
export function facingFromLook(yaw: number, pitch: number): FaceId {
  const [dx, dy, dz] = lookDirection(yaw, pitch);
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const az = Math.abs(dz);
  if (ay > ax && ay > az) return dy > 0 ? Face.Up : Face.Down;
  if (ax > az) return dx > 0 ? Face.East : Face.West;
  return dz > 0 ? Face.South : Face.North;
}

/** Blocks whose front should face the player instead of away from them. */
const FACES_PLAYER = new Set<number>([B.CHEST, B.CRAFTING_TABLE, B.PISTON, B.STICKY_PISTON]);

export interface PlacementContext {
  /** Face of the targeted block that was clicked. */
  face: FaceId;
  yaw: number;
  pitch: number;
  /** Fractional height (0..1) of the hit point on the clicked block face. */
  hitY: number;
}

/** Compute the metadata of a newly placed block from the player's view. */
export function computePlacementMeta(id: number, ctx: PlacementContext): number {
  const def = getBlock(id);
  switch (def.orientation) {
    case 'horizontal': {
      const look = horizontalFacingFromYaw(ctx.yaw);
      return makeMeta(FACES_PLAYER.has(id) ? look ^ 1 : look);
    }
    case 'all': {
      const look = facingFromLook(ctx.yaw, ctx.pitch);
      return makeMeta(FACES_PLAYER.has(id) ? look ^ 1 : look);
    }
    case 'attach':
      return makeMeta(ctx.face);
    default:
      break;
  }
  if (def.shape === 'slab') {
    const top = ctx.face === Face.Down || (ctx.face !== Face.Up && ctx.hitY > 0.5);
    return makeMeta(0, top ? 1 : 0);
  }
  return 0;
}

/** Faces an attachable block may be placed against. */
export function isValidAttachFace(id: number, face: FaceId): boolean {
  if (id === B.PRESSURE_PLATE || id === B.WIRE || getBlock(id).shape === 'gate' || id === B.DOOR) {
    return face === Face.Up;
  }
  return true;
}

/**
 * Block metadata (one byte per voxel).
 *
 *   bits 0-2  facing   (face id 0..5, see constants.ts)
 *   bit  3    powered
 *   bit  4    active   (open door, extended piston, pressed button, lit timer...)
 *   bits 5-7  variant  (slab half, door half, repeater delay, piston stroke...)
 *
 * Signal wires use bits 0-3 as their power level (0..15) instead.
 */

export const META_FACING_MASK = 0b0000_0111;
export const META_POWERED = 0b0000_1000;
export const META_ACTIVE = 0b0001_0000;
export const META_VARIANT_SHIFT = 5;
export const META_VARIANT_MASK = 0b1110_0000;

export function getFacing(meta: number): number {
  return meta & META_FACING_MASK;
}

export function withFacing(meta: number, facing: number): number {
  return (meta & ~META_FACING_MASK) | (facing & META_FACING_MASK);
}

export function isPowered(meta: number): boolean {
  return (meta & META_POWERED) !== 0;
}

export function withPowered(meta: number, powered: boolean): number {
  return powered ? meta | META_POWERED : meta & ~META_POWERED;
}

export function isActive(meta: number): boolean {
  return (meta & META_ACTIVE) !== 0;
}

export function withActive(meta: number, active: boolean): number {
  return active ? meta | META_ACTIVE : meta & ~META_ACTIVE;
}

export function getVariant(meta: number): number {
  return (meta & META_VARIANT_MASK) >> META_VARIANT_SHIFT;
}

export function withVariant(meta: number, variant: number): number {
  return (meta & ~META_VARIANT_MASK) | ((variant << META_VARIANT_SHIFT) & META_VARIANT_MASK);
}

export function getWirePower(meta: number): number {
  return meta & 0x0f;
}

export function withWirePower(meta: number, power: number): number {
  return (meta & 0xf0) | (power & 0x0f);
}

export function makeMeta(facing = 0, variant = 0, powered = false, active = false): number {
  return withActive(withPowered(withVariant(withFacing(0, facing), variant), powered), active);
}

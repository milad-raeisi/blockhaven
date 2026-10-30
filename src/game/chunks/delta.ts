import { CHUNK_VOLUME } from '../world/constants';
import type { Chunk } from './chunk';

/**
 * Sparse chunk modifications relative to generated terrain.
 *
 * Binary layout (little endian):
 *   u32 count
 *   count x { u16 index, u8 block, u8 meta }
 */
export interface DeltaEntry {
  index: number;
  id: number;
  meta: number;
}

/** Map of local block index -> packed (id << 8 | meta). */
export type DeltaMap = Map<number, number>;

export function packBlock(id: number, meta: number): number {
  return (id << 8) | (meta & 0xff);
}

export function unpackBlock(packed: number): [number, number] {
  return [packed >> 8, packed & 0xff];
}

export function encodeDelta(delta: DeltaMap): Uint8Array {
  const out = new Uint8Array(4 + delta.size * 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, delta.size, true);
  let offset = 4;
  const keys = [...delta.keys()].sort((a, b) => a - b);
  for (const index of keys) {
    const packed = delta.get(index)!;
    view.setUint16(offset, index, true);
    out[offset + 2] = packed >> 8;
    out[offset + 3] = packed & 0xff;
    offset += 4;
  }
  return out;
}

export function decodeDelta(bytes: Uint8Array): DeltaMap {
  const delta: DeltaMap = new Map();
  if (bytes.byteLength < 4) return delta;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(0, true);
  if (bytes.byteLength < 4 + count * 4) throw new Error('Truncated chunk delta');
  let offset = 4;
  for (let i = 0; i < count; i++) {
    const index = view.getUint16(offset, true);
    if (index < CHUNK_VOLUME) delta.set(index, packBlock(bytes[offset + 2], bytes[offset + 3]));
    offset += 4;
  }
  return delta;
}

export function applyDelta(chunk: Chunk, delta: DeltaMap): void {
  for (const [index, packed] of delta) {
    chunk.blocks[index] = packed >> 8;
    chunk.meta[index] = packed & 0xff;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

/** Environment-independent base64 encoding for binary payloads. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)] ?? 0;
    const d = B64_LOOKUP[clean.charCodeAt(i + 3)] ?? 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

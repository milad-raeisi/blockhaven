import { Chunk } from '../../src/game/chunks/chunk';
import { applyDelta, packBlock, type DeltaMap } from '../../src/game/chunks/delta';
import { TerrainGenerator, type TerrainType } from '../../src/game/terrain/generator';
import { UNLOADED, type BlockAccess } from '../../src/game/world/blockAccess';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../../src/game/world/constants';
import { chunkKey, localIndex, parseChunkKey, toChunkCoord } from '../../src/game/world/coords';
import type { ChunkSave, StoredChunk, WorldRepository } from '../persistence/worldRepository';

interface ChunkRecord {
  revision: number;
  delta: DeltaMap;
  /** Fully generated voxel data with the delta applied (only near players / mechanisms). */
  chunk: Chunk | null;
  lastUsed: number;
}

/**
 * Authoritative world state for one room. Terrain is regenerated from the
 * seed on demand; only per-chunk deltas are kept in memory long term and
 * persisted to PostgreSQL.
 */
export class ServerWorld implements BlockAccess {
  readonly generator: TerrainGenerator;
  private readonly records = new Map<string, ChunkRecord>();
  private readonly pending = new Map<string, Promise<ChunkRecord>>();
  private readonly dirty = new Set<string>();
  /** Called after a chunk becomes fully loaded (used to wake up circuits). */
  onChunkGenerated: ((chunk: Chunk) => void) | null = null;

  constructor(
    readonly worldId: string,
    seed: string,
    terrainType: TerrainType,
    private readonly repo: WorldRepository,
  ) {
    this.generator = new TerrainGenerator(seed, terrainType);
  }

  // --- Loading -------------------------------------------------------------

  /** Load deltas for many chunks with one database query. */
  async loadRecords(coords: ReadonlyArray<readonly [number, number]>): Promise<void> {
    const missing = coords.filter(([cx, cz]) => {
      const key = chunkKey(cx, cz);
      return !this.records.has(key) && !this.pending.has(key);
    });
    if (missing.length) {
      const batch = this.repo.loadChunks(this.worldId, missing);
      for (const [cx, cz] of missing) {
        const key = chunkKey(cx, cz);
        const promise = batch.then((rows) => this.installRecord(key, rows.get(key)));
        this.pending.set(key, promise);
        promise.finally(() => this.pending.delete(key)).catch(() => undefined);
      }
    }
    await Promise.all(coords.map(([cx, cz]) => this.pending.get(chunkKey(cx, cz))).filter(Boolean));
  }

  private installRecord(key: string, stored: StoredChunk | undefined): ChunkRecord {
    const existing = this.records.get(key);
    if (existing) return existing;
    const record: ChunkRecord = { revision: stored?.revision ?? 0, delta: stored?.delta ?? new Map(), chunk: null, lastUsed: Date.now() };
    this.records.set(key, record);
    return record;
  }

  /** Ensure a chunk is fully generated in memory (needed for physics and edits). */
  async ensureChunk(cx: number, cz: number): Promise<Chunk> {
    const key = chunkKey(cx, cz);
    if (!this.records.has(key)) await this.loadRecords([[cx, cz]]);
    return this.generateRecordChunk(key);
  }

  async ensureChunks(coords: ReadonlyArray<readonly [number, number]>): Promise<void> {
    await this.loadRecords(coords);
    for (const [cx, cz] of coords) this.generateRecordChunk(chunkKey(cx, cz));
  }

  private generateRecordChunk(key: string): Chunk {
    const record = this.records.get(key);
    if (!record) throw new Error(`Chunk record ${key} not loaded`);
    record.lastUsed = Date.now();
    if (!record.chunk) {
      const [cx, cz] = parseChunkKey(key);
      const chunk = this.generator.generateChunk(cx, cz);
      applyDelta(chunk, record.delta);
      record.chunk = chunk;
      this.onChunkGenerated?.(chunk);
    }
    return record.chunk;
  }

  getRecordInfo(cx: number, cz: number): { revision: number; delta: DeltaMap } | null {
    const record = this.records.get(chunkKey(cx, cz));
    if (!record) return null;
    record.lastUsed = Date.now();
    return { revision: record.revision, delta: record.delta };
  }

  isChunkGenerated(cx: number, cz: number): boolean {
    return !!this.records.get(chunkKey(cx, cz))?.chunk;
  }

  getChunk(cx: number, cz: number): Chunk | null {
    return this.records.get(chunkKey(cx, cz))?.chunk ?? null;
  }

  // --- BlockAccess -----------------------------------------------------------

  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return UNLOADED;
    if (y >= WORLD_HEIGHT) return 0;
    const chunk = this.records.get(chunkKey(toChunkCoord(x), toChunkCoord(z)))?.chunk;
    if (!chunk) return UNLOADED;
    return chunk.blocks[localIndex(Math.floor(x) & (CHUNK_SIZE - 1), Math.floor(y), Math.floor(z) & (CHUNK_SIZE - 1))];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const chunk = this.records.get(chunkKey(toChunkCoord(x), toChunkCoord(z)))?.chunk;
    if (!chunk) return 0;
    return chunk.meta[localIndex(Math.floor(x) & (CHUNK_SIZE - 1), Math.floor(y), Math.floor(z) & (CHUNK_SIZE - 1))];
  }

  /**
   * Change a block in a generated chunk. Records the change in the chunk delta,
   * bumps the revision and marks the chunk dirty. Returns false if the chunk is
   * not loaded or nothing changed.
   */
  setBlock(x: number, y: number, z: number, id: number, meta = 0): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const key = chunkKey(toChunkCoord(x), toChunkCoord(z));
    const record = this.records.get(key);
    if (!record?.chunk) return false;
    const index = localIndex(Math.floor(x) & (CHUNK_SIZE - 1), y, Math.floor(z) & (CHUNK_SIZE - 1));
    if (record.chunk.blocks[index] === id && record.chunk.meta[index] === meta) return false;
    record.chunk.blocks[index] = id;
    record.chunk.meta[index] = meta;
    record.delta.set(index, packBlock(id, meta));
    record.revision++;
    record.lastUsed = Date.now();
    this.dirty.add(key);
    return true;
  }

  // --- Persistence -------------------------------------------------------------

  get dirtyCount(): number {
    return this.dirty.size;
  }

  /** Snapshot and clear the dirty set. Call `restoreDirty` if saving fails. */
  takeDirty(): ChunkSave[] {
    const saves: ChunkSave[] = [];
    for (const key of this.dirty) {
      const record = this.records.get(key);
      if (!record) continue;
      const [cx, cz] = parseChunkKey(key);
      saves.push({ cx, cz, revision: record.revision, delta: new Map(record.delta) });
    }
    this.dirty.clear();
    return saves;
  }

  restoreDirty(saves: ChunkSave[]): void {
    for (const s of saves) this.dirty.add(chunkKey(s.cx, s.cz));
  }

  /**
   * Drop chunk data that is no longer needed. Generated voxel data outside
   * `keepGenerated` is released; delta records not in `keepRecords` are released
   * unless they still have unsaved changes.
   */
  unloadUnused(keepGenerated: Set<string>, keepRecords: Set<string>): number {
    let released = 0;
    for (const [key, record] of this.records) {
      if (record.chunk && !keepGenerated.has(key)) {
        record.chunk = null;
        released++;
      }
      if (!keepRecords.has(key) && !keepGenerated.has(key) && !this.dirty.has(key) && !this.pending.has(key)) {
        this.records.delete(key);
      }
    }
    return released;
  }

  get loadedChunkCount(): number {
    let n = 0;
    for (const r of this.records.values()) if (r.chunk) n++;
    return n;
  }
}

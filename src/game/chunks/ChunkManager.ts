import { getBlock, getLightEmission, TRANSPARENT } from '../blocks/registry';
import type { TerrainType } from '../terrain/generator';
import { ChunkStore } from '../world/blockAccess';
import { CHUNK_SIZE } from '../world/constants';
import { chunkKey, toChunkCoord } from '../world/coords';
import type { ChunkMeshes, Renderer } from '../renderer/Renderer';
import type { WorkerRequest, WorkerResponse } from '../workers/protocol';
import { Chunk } from './chunk';
import { applyDelta, base64ToBytes, decodeDelta, type DeltaMap } from './delta';
import type { MeshOutput } from './mesher';

interface ClientChunk {
  cx: number;
  cz: number;
  key: string;
  chunk: Chunk | null;
  generating: boolean;
  requested: boolean;
  /** Time the outstanding request was sent (0 when not awaiting data). */
  awaitingSince: number;
  /** Revision of the server delta applied; -1 until received. */
  revision: number;
  pendingDelta: DeltaMap | null;
  pendingChanges: [number, number, number, number, number][];
  ready: boolean;
  version: number;
  meshedVersion: number;
  meshing: boolean;
  urgent: boolean;
  meshes: ChunkMeshes | undefined;
}

export interface ChunkRequester {
  requestChunks(chunks: [number, number, number][]): void;
  releaseChunks(chunks: [number, number][]): void;
}

type Job = { resolve: (r: WorkerResponse) => void; worker: number };

const MAX_INFLIGHT_REQUESTS = 96;
/** Re-request chunk data if the server has not answered within this time. */
const REQUEST_TIMEOUT_MS = 6000;
const MAX_REQUEST_BATCH = 64;

/**
 * Client-side chunk lifecycle: requests chunk deltas from the server,
 * generates base terrain in workers, applies deltas, schedules meshing by
 * distance and keeps meshes in sync with block edits.
 */
export class ChunkManager {
  readonly store = new ChunkStore();
  private readonly chunks = new Map<string, ClientChunk>();
  private readonly workers: Worker[] = [];
  private readonly workerLoad: number[] = [];
  private readonly jobs = new Map<number, Job>();
  private nextJob = 1;
  private centerX = 0;
  private centerZ = 0;
  private renderDistance: number;
  private disposed = false;
  lastMeshMs = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly requester: ChunkRequester,
    seed: string,
    terrainType: TerrainType,
    renderDistance: number,
  ) {
    this.renderDistance = renderDistance;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
    const count = Math.max(1, Math.min(4, cores - 1));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('../workers/chunk.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.onWorkerMessage(i, event.data);
      worker.onerror = (event) => console.error('Chunk worker error', event.message);
      const init: WorkerRequest = { type: 'init', seed, terrainType };
      worker.postMessage(init);
      this.workers.push(worker);
      this.workerLoad.push(0);
    }
  }

  setRenderDistance(distance: number): void {
    this.renderDistance = distance;
  }

  get stats(): { loaded: number; meshed: number; pending: number } {
    let meshed = 0;
    let pending = 0;
    for (const c of this.chunks.values()) {
      if (c.meshes) meshed++;
      if (!c.ready) pending++;
    }
    return { loaded: this.chunks.size, meshed, pending };
  }

  /** True when the chunk containing (x, z) and its neighbours are ready for physics. */
  isAreaReady(x: number, z: number): boolean {
    const cx = toChunkCoord(x);
    const cz = toChunkCoord(z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.get(chunkKey(cx + dx, cz + dz))?.ready) return false;
    return true;
  }

  // --- Workers ---------------------------------------------------------------------

  private pickWorker(): number {
    let best = 0;
    for (let i = 1; i < this.workers.length; i++) if (this.workerLoad[i] < this.workerLoad[best]) best = i;
    return best;
  }

  private run(request: WorkerRequest & { id: number }, transfer: Transferable[] = []): Promise<WorkerResponse> {
    const worker = this.pickWorker();
    this.workerLoad[worker]++;
    return new Promise((resolve) => {
      this.jobs.set(request.id, { resolve, worker });
      this.workers[worker].postMessage(request, transfer);
    });
  }

  private onWorkerMessage(_index: number, msg: WorkerResponse): void {
    const job = this.jobs.get(msg.id);
    if (!job) return;
    this.jobs.delete(msg.id);
    this.workerLoad[job.worker]--;
    if (msg.type === 'error') console.error('Chunk worker failed:', msg.message);
    job.resolve(msg);
  }

  // --- Lifecycle ------------------------------------------------------------------------

  /** Called every frame with the player position. */
  update(x: number, z: number): void {
    if (this.disposed) return;
    this.centerX = toChunkCoord(x);
    this.centerZ = toChunkCoord(z);
    const loadRadius = this.renderDistance + 1;

    // Unload chunks outside the load radius (with a little hysteresis).
    const release: [number, number][] = [];
    for (const c of this.chunks.values()) {
      if (Math.max(Math.abs(c.cx - this.centerX), Math.abs(c.cz - this.centerZ)) > loadRadius + 1) {
        if (c.meshes) this.renderer.disposeChunkMeshes(c.meshes);
        this.chunks.delete(c.key);
        this.store.deleteChunk(c.cx, c.cz);
        if (c.requested && c.revision >= 0) release.push([c.cx, c.cz]);
      }
    }
    for (let i = 0; i < release.length; i += 256) this.requester.releaseChunks(release.slice(i, i + 256));

    // Create missing chunks in the circular load area, nearest first.
    const wanted: [number, number, number][] = [];
    for (let dz = -loadRadius; dz <= loadRadius; dz++) {
      for (let dx = -loadRadius; dx <= loadRadius; dx++) {
        if (dx * dx + dz * dz > (loadRadius + 0.5) * (loadRadius + 0.5)) continue;
        const key = chunkKey(this.centerX + dx, this.centerZ + dz);
        if (!this.chunks.has(key)) wanted.push([this.centerX + dx, this.centerZ + dz, dx * dx + dz * dz]);
      }
    }
    wanted.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of wanted) this.chunks.set(chunkKey(cx, cz), this.createChunk(cx, cz));

    this.requestMissing();
    this.startGeneration();
    this.scheduleMeshing();
  }

  private createChunk(cx: number, cz: number): ClientChunk {
    return {
      cx,
      cz,
      key: chunkKey(cx, cz),
      chunk: null,
      generating: false,
      requested: false,
      awaitingSince: 0,
      revision: -1,
      pendingDelta: null,
      pendingChanges: [],
      ready: false,
      version: 0,
      meshedVersion: -1,
      meshing: false,
      urgent: false,
      meshes: undefined,
    };
  }

  private distance(c: { cx: number; cz: number }): number {
    const dx = c.cx - this.centerX;
    const dz = c.cz - this.centerZ;
    return dx * dx + dz * dz;
  }

  private requestMissing(): void {
    const now = performance.now();
    let inflight = 0;
    for (const c of this.chunks.values()) {
      if (c.awaitingSince === 0) continue;
      if (now - c.awaitingSince > REQUEST_TIMEOUT_MS) {
        c.awaitingSince = 0;
        c.requested = false;
      } else {
        inflight++;
      }
    }
    if (inflight >= MAX_INFLIGHT_REQUESTS) return;
    const pending = [...this.chunks.values()].filter((c) => !c.requested).sort((a, b) => this.distance(a) - this.distance(b));
    const batch: [number, number, number][] = [];
    for (const c of pending) {
      if (inflight >= MAX_INFLIGHT_REQUESTS) break;
      c.requested = true;
      c.awaitingSince = now;
      inflight++;
      batch.push([c.cx, c.cz, c.revision]);
      if (batch.length === MAX_REQUEST_BATCH) this.requester.requestChunks(batch.splice(0));
    }
    if (batch.length) this.requester.requestChunks(batch);
  }

  private startGeneration(): void {
    const maxJobs = this.workers.length * 3;
    if (this.jobs.size >= maxJobs) return;
    const candidates = [...this.chunks.values()].filter((c) => !c.chunk && !c.generating).sort((a, b) => this.distance(a) - this.distance(b));
    for (const c of candidates) {
      if (this.jobs.size >= maxJobs) break;
      c.generating = true;
      const id = this.nextJob++;
      void this.run({ type: 'generate', id, cx: c.cx, cz: c.cz }).then((res) => {
        if (res.type !== 'generated' || this.disposed) return;
        const current = this.chunks.get(c.key);
        if (current !== c) return;
        c.chunk = new Chunk(c.cx, c.cz, new Uint8Array(res.blocks), new Uint8Array(res.meta));
        c.generating = false;
        this.tryFinalize(c);
      });
    }
  }

  /** A chunk becomes ready once both the base terrain and the server delta are present. */
  private tryFinalize(c: ClientChunk): void {
    if (!c.chunk || c.revision < 0) return;
    if (c.pendingDelta) {
      applyDelta(c.chunk, c.pendingDelta);
      c.pendingDelta = null;
    }
    if (!c.ready) {
      c.ready = true;
      this.store.setChunk(c.chunk);
    }
    for (const [x, y, z, id, meta] of c.pendingChanges.splice(0)) c.chunk.setBlock(x & 15, y, z & 15, id, meta);
    this.markNeighbourhoodDirty(c.cx, c.cz);
  }

  private markDirty(cx: number, cz: number, urgent = false): void {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return;
    c.version++;
    if (urgent) c.urgent = true;
  }

  private markNeighbourhoodDirty(cx: number, cz: number, urgent = false): void {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) this.markDirty(cx + dx, cz + dz, urgent && dx === 0 && dz === 0);
  }

  private scheduleMeshing(): void {
    const maxJobs = this.workers.length * 2;
    const candidates: ClientChunk[] = [];
    for (const c of this.chunks.values()) {
      if (!c.ready || c.meshing || c.meshedVersion === c.version) continue;
      const d = Math.max(Math.abs(c.cx - this.centerX), Math.abs(c.cz - this.centerZ));
      if (d > this.renderDistance) continue;
      if (!this.neighboursReady(c)) continue;
      candidates.push(c);
    }
    candidates.sort((a, b) => Number(b.urgent) - Number(a.urgent) || this.distance(a) - this.distance(b));
    for (const c of candidates) {
      // Urgent re-meshes (player edits) may exceed the normal job limit.
      if (this.jobs.size >= maxJobs && !c.urgent) break;
      this.meshChunk(c);
    }
  }

  private neighboursReady(c: ClientChunk): boolean {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!this.chunks.get(chunkKey(c.cx + dx, c.cz + dz))?.ready) return false;
    return true;
  }

  private meshChunk(c: ClientChunk): void {
    const blocks: ArrayBuffer[] = [];
    const meta: ArrayBuffer[] = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz))!.chunk!;
        blocks.push(n.blocks.slice().buffer);
        meta.push(n.meta.slice().buffer);
      }
    }
    const version = c.version;
    c.meshing = true;
    c.urgent = false;
    const id = this.nextJob++;
    void this.run({ type: 'mesh', id, blocks, meta }, [...blocks, ...meta]).then((res) => {
      c.meshing = false;
      if (res.type !== 'meshed' || this.disposed || this.chunks.get(c.key) !== c) return;
      this.lastMeshMs = res.ms;
      this.applyMesh(c, res.mesh, version);
    });
  }

  private applyMesh(c: ClientChunk, mesh: MeshOutput, version: number): void {
    c.meshes = this.renderer.setChunkMeshes(c.cx, c.cz, c.meshes, mesh);
    c.meshedVersion = version;
  }

  // --- Network -----------------------------------------------------------------------------

  async onChunkData(cx: number, cz: number, revision: number, encoding: 'raw' | 'deflate' | 'unchanged', data: string): Promise<void> {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return;
    c.awaitingSince = 0;
    if (encoding === 'unchanged') {
      c.revision = revision;
      this.tryFinalize(c);
      return;
    }
    let bytes = base64ToBytes(data);
    if (encoding === 'deflate') bytes = await inflate(bytes);
    if (this.chunks.get(c.key) !== c) return;
    const delta = decodeDelta(bytes);
    c.revision = revision;
    if (c.chunk && c.ready) {
      applyDelta(c.chunk, delta);
      this.markNeighbourhoodDirty(cx, cz);
    } else {
      c.pendingDelta = delta;
      this.tryFinalize(c);
    }
  }

  /** Re-request every chunk after reconnecting; unchanged chunks are confirmed cheaply. */
  resync(): void {
    for (const c of this.chunks.values()) {
      c.requested = false;
      c.awaitingSince = 0;
    }
  }

  /** Apply block changes from the server or local prediction. */
  applyBlockChanges(changes: readonly [number, number, number, number, number][], urgent: boolean): void {
    for (const change of changes) {
      const [x, y, z, id, meta] = change;
      const cx = toChunkCoord(x);
      const cz = toChunkCoord(z);
      const c = this.chunks.get(chunkKey(cx, cz));
      if (!c) continue;
      if (!c.ready || !c.chunk) {
        c.pendingChanges.push([x, y, z, id, meta]);
        continue;
      }
      const lx = x & (CHUNK_SIZE - 1);
      const lz = z & (CHUNK_SIZE - 1);
      const oldId = c.chunk.getBlock(lx, y, lz);
      const oldMeta = c.chunk.getMeta(lx, y, lz);
      if (oldId === id && oldMeta === meta) continue;
      c.chunk.setBlock(lx, y, lz, id, meta);
      const lightChanged =
        TRANSPARENT[oldId] !== TRANSPARENT[id] || getLightEmission(oldId, oldMeta) !== getLightEmission(id, meta) || getBlock(oldId).lightFilter !== getBlock(id).lightFilter;
      if (lightChanged) {
        this.markNeighbourhoodDirty(cx, cz, urgent);
      } else {
        this.markDirty(cx, cz, urgent);
        // Faces on chunk borders and shapes that depend on neighbours (wires, fences).
        if (lx <= 1) this.markDirty(cx - 1, cz, urgent);
        if (lx >= CHUNK_SIZE - 2) this.markDirty(cx + 1, cz, urgent);
        if (lz <= 1) this.markDirty(cx, cz - 1, urgent);
        if (lz >= CHUNK_SIZE - 2) this.markDirty(cx, cz + 1, urgent);
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const c of this.chunks.values()) if (c.meshes) this.renderer.disposeChunkMeshes(c.meshes);
    this.chunks.clear();
    for (const w of this.workers) w.terminate();
    this.jobs.clear();
  }
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/// <reference lib="webworker" />
import { assembleRegion, meshRegion, type MeshOutput } from '../chunks/mesher';
import { TerrainGenerator } from '../terrain/generator';
import type { WorkerRequest, WorkerResponse } from './protocol';

/**
 * Background worker for expensive chunk work: deterministic terrain generation
 * and mesh building, keeping the render thread responsive.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
let generator: TerrainGenerator | null = null;

function transferables(mesh: MeshOutput): ArrayBuffer[] {
  const list: ArrayBuffer[] = [];
  for (const layer of Object.values(mesh)) {
    if (!layer) continue;
    list.push(layer.positions.buffer as ArrayBuffer, layer.normals.buffer as ArrayBuffer, layer.uvs.buffer as ArrayBuffer, layer.data.buffer as ArrayBuffer, layer.indices.buffer as ArrayBuffer);
  }
  return list;
}

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init':
        generator = new TerrainGenerator(msg.seed, msg.terrainType);
        break;
      case 'generate': {
        if (!generator) throw new Error('Worker not initialised');
        const chunk = generator.generateChunk(msg.cx, msg.cz);
        const response: WorkerResponse = {
          type: 'generated',
          id: msg.id,
          cx: msg.cx,
          cz: msg.cz,
          blocks: chunk.blocks.buffer as ArrayBuffer,
          meta: chunk.meta.buffer as ArrayBuffer,
        };
        ctx.postMessage(response, [response.blocks, response.meta]);
        break;
      }
      case 'mesh': {
        const start = performance.now();
        const region = assembleRegion(
          msg.blocks.map((b) => new Uint8Array(b)),
          msg.meta.map((m) => new Uint8Array(m)),
        );
        const mesh = meshRegion(region.blocks, region.meta);
        const response: WorkerResponse = { type: 'meshed', id: msg.id, mesh, ms: performance.now() - start };
        ctx.postMessage(response, transferables(mesh));
        break;
      }
    }
  } catch (error) {
    const id = 'id' in msg ? msg.id : -1;
    const response: WorkerResponse = { type: 'error', id, message: error instanceof Error ? error.message : String(error) };
    ctx.postMessage(response);
  }
};

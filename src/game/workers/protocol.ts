import type { MeshOutput } from '../chunks/mesher';
import type { TerrainType } from '../terrain/generator';

/** Messages between the main thread and chunk workers. */
export type WorkerRequest =
  | { type: 'init'; seed: string; terrainType: TerrainType }
  | { type: 'generate'; id: number; cx: number; cz: number }
  | {
      type: 'mesh';
      id: number;
      /** 3x3 neighbourhood, index (dz+1)*3 + (dx+1); centre is index 4. */
      blocks: ArrayBuffer[];
      meta: ArrayBuffer[];
    };

export type WorkerResponse =
  | { type: 'generated'; id: number; cx: number; cz: number; blocks: ArrayBuffer; meta: ArrayBuffer }
  | { type: 'meshed'; id: number; mesh: MeshOutput; ms: number }
  | { type: 'error'; id: number; message: string };

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import type { GameMode, Prisma, PrismaClient, World, WorldMembership, WorldSettings } from '@prisma/client';
import { decodeDelta, encodeDelta, type DeltaMap } from '../../src/game/chunks/delta';
import { CHEST_SIZE, INVENTORY_SIZE, sanitizeSlots, type Slot } from '../../src/game/inventory/inventory';
import { chunkKey } from '../../src/game/world/coords';

export type WorldWithSettings = World & { settings: WorldSettings | null; owner: { displayName: string } };

export interface StoredChunk {
  revision: number;
  delta: DeltaMap;
}

export interface ChunkSave {
  cx: number;
  cz: number;
  revision: number;
  delta: DeltaMap;
}

export interface PlayerStateSave {
  playerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  gameMode: GameMode;
  flying: boolean;
  selectedSlot: number;
  stats: Record<string, number>;
  inventory: Slot[];
}

export interface LoadedPlayerState extends Omit<PlayerStateSave, 'playerId'> {}

export interface ContainerSave {
  x: number;
  y: number;
  z: number;
  slots: Slot[] | null;
}

export function compressDelta(delta: DeltaMap): Uint8Array<ArrayBuffer> {
  const compressed = deflateRawSync(encodeDelta(delta));
  const out = new Uint8Array(new ArrayBuffer(compressed.length));
  out.set(compressed);
  return out;
}

export function decompressDelta(data: Uint8Array): DeltaMap {
  return decodeDelta(new Uint8Array(inflateRawSync(data)));
}

/** All PostgreSQL access for worlds, chunks, players and containers. */
export class WorldRepository {
  constructor(private readonly prisma: PrismaClient) {}

  getWorld(id: string): Promise<WorldWithSettings | null> {
    return this.prisma.world.findUnique({ where: { id }, include: { settings: true, owner: { select: { displayName: true } } } });
  }

  listWorldsForPlayer(playerId: string): Promise<WorldWithSettings[]> {
    return this.prisma.world.findMany({
      where: { OR: [{ visibility: 'PUBLIC' }, { ownerId: playerId }] },
      include: { settings: true, owner: { select: { displayName: true } } },
      orderBy: [{ lastPlayedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  createWorld(data: Prisma.WorldUncheckedCreateInput, settings: Omit<Prisma.WorldSettingsUncheckedCreateInput, 'worldId'>): Promise<World> {
    return this.prisma.world.create({ data: { ...data, settings: { create: settings } } });
  }

  async deleteWorld(id: string): Promise<void> {
    await this.prisma.world.delete({ where: { id } });
  }

  async loadChunks(worldId: string, coords: ReadonlyArray<readonly [number, number]>): Promise<Map<string, StoredChunk>> {
    const result = new Map<string, StoredChunk>();
    if (coords.length === 0) return result;
    const rows = await this.prisma.worldChunk.findMany({
      where: { worldId, OR: coords.map(([cx, cz]) => ({ cx, cz })) },
    });
    for (const row of rows) {
      result.set(chunkKey(row.cx, row.cz), { revision: row.revision, delta: decompressDelta(row.data) });
    }
    return result;
  }

  /**
   * Persist one consistent snapshot of a world (dirty chunks, world clock,
   * player positions/inventories and containers) in a single transaction.
   */
  async saveSnapshot(
    worldId: string,
    snapshot: {
      chunks: ChunkSave[];
      worldState: { worldTime: number; weather: string } | null;
      players: PlayerStateSave[];
      containers: ContainerSave[];
    },
  ): Promise<void> {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const c of snapshot.chunks) {
      const data = compressDelta(c.delta);
      ops.push(
        this.prisma.worldChunk.upsert({
          where: { worldId_cx_cz: { worldId, cx: c.cx, cz: c.cz } },
          create: { worldId, cx: c.cx, cz: c.cz, revision: c.revision, data },
          update: { revision: c.revision, data },
        }),
      );
    }
    if (snapshot.worldState) {
      ops.push(
        this.prisma.world.update({
          where: { id: worldId },
          data: { worldTime: snapshot.worldState.worldTime, weather: snapshot.worldState.weather, lastPlayedAt: new Date() },
        }),
      );
    }
    ops.push(...this.playerStateOps(worldId, snapshot.players), ...this.containerOps(worldId, snapshot.containers));
    if (ops.length) await this.prisma.$transaction(ops);
  }

  async updateSettings(worldId: string, data: Prisma.WorldSettingsUpdateInput): Promise<void> {
    await this.prisma.worldSettings.update({ where: { worldId }, data });
  }

  async loadPlayerState(playerId: string, worldId: string): Promise<LoadedPlayerState | null> {
    const [state, inventory] = await Promise.all([
      this.prisma.playerWorldState.findUnique({ where: { playerId_worldId: { playerId, worldId } } }),
      this.prisma.playerInventory.findUnique({ where: { playerId_worldId: { playerId, worldId } } }),
    ]);
    if (!state) return null;
    return {
      x: state.x,
      y: state.y,
      z: state.z,
      yaw: state.yaw,
      pitch: state.pitch,
      gameMode: state.gameMode,
      flying: state.flying,
      selectedSlot: state.selectedSlot,
      stats: (state.stats ?? {}) as Record<string, number>,
      inventory: sanitizeSlots(inventory?.slots, INVENTORY_SIZE),
    };
  }

  private playerStateOps(worldId: string, states: PlayerStateSave[]): Prisma.PrismaPromise<unknown>[] {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const s of states) {
      const data = {
        x: s.x,
        y: s.y,
        z: s.z,
        yaw: s.yaw,
        pitch: s.pitch,
        gameMode: s.gameMode,
        flying: s.flying,
        selectedSlot: s.selectedSlot,
        stats: s.stats,
      };
      ops.push(
        this.prisma.playerWorldState.upsert({
          where: { playerId_worldId: { playerId: s.playerId, worldId } },
          create: { playerId: s.playerId, worldId, ...data },
          update: data,
        }),
        this.prisma.playerInventory.upsert({
          where: { playerId_worldId: { playerId: s.playerId, worldId } },
          create: { playerId: s.playerId, worldId, slots: s.inventory as Prisma.InputJsonValue },
          update: { slots: s.inventory as Prisma.InputJsonValue },
        }),
      );
    }
    return ops;
  }

  getMembership(worldId: string, playerId: string): Promise<WorldMembership | null> {
    return this.prisma.worldMembership.findUnique({ where: { worldId_playerId: { worldId, playerId } } });
  }

  ensureMembership(worldId: string, playerId: string, role: 'OWNER' | 'VISITOR', canBuild: boolean): Promise<WorldMembership> {
    return this.prisma.worldMembership.upsert({
      where: { worldId_playerId: { worldId, playerId } },
      create: { worldId, playerId, role, canBuild },
      update: {},
    });
  }

  async setCanBuild(worldId: string, playerId: string, canBuild: boolean): Promise<void> {
    await this.prisma.worldMembership.updateMany({ where: { worldId, playerId }, data: { canBuild } });
  }

  async loadContainer(worldId: string, x: number, y: number, z: number): Promise<Slot[] | null> {
    const row = await this.prisma.containerInventory.findUnique({ where: { worldId_x_y_z: { worldId, x, y, z } } });
    return row ? sanitizeSlots(row.slots, CHEST_SIZE) : null;
  }

  private containerOps(worldId: string, containers: ContainerSave[]): Prisma.PrismaPromise<unknown>[] {
    return containers.map((c) =>
      c.slots === null
        ? this.prisma.containerInventory.deleteMany({ where: { worldId, x: c.x, y: c.y, z: c.z } })
        : this.prisma.containerInventory.upsert({
            where: { worldId_x_y_z: { worldId, x: c.x, y: c.y, z: c.z } },
            create: { worldId, x: c.x, y: c.y, z: c.z, slots: c.slots as Prisma.InputJsonValue },
            update: { slots: c.slots as Prisma.InputJsonValue },
          }),
    );
  }
}

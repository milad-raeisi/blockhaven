import * as THREE from 'three';
import type { ChunkMaterials } from '../renderer/materials';
import { PlayerFlags, type PlayerInfo, type RemotePlayerState } from '../../network/protocol/messages';
import { PlayerModel } from './PlayerModel';

interface Snapshot {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flags: number;
  held: number;
}

interface Remote {
  info: PlayerInfo;
  model: PlayerModel;
  buffer: Snapshot[];
  lastX: number;
  lastZ: number;
  lastSeen: number;
}

/** Remote players are rendered this far in the past so there are always two snapshots to blend. */
export const INTERPOLATION_DELAY_MS = 110;

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Interpolated rendering of other players from server snapshots. */
export class RemotePlayers {
  readonly group = new THREE.Group();
  private readonly remotes = new Map<string, Remote>();

  constructor(private readonly materials: ChunkMaterials) {}

  setPlayers(players: PlayerInfo[], selfId: string | null): void {
    const ids = new Set(players.map((p) => p.id));
    for (const [id, remote] of this.remotes) {
      if (!ids.has(id) || id === selfId) this.remove(id, remote);
    }
    for (const info of players) {
      if (info.id === selfId) continue;
      const existing = this.remotes.get(info.id);
      if (existing) {
        existing.info = info;
        existing.model.root.visible = info.gameMode !== 'spectator';
        continue;
      }
      const model = new PlayerModel(info.name, info.appearance, this.materials);
      model.root.visible = false;
      this.group.add(model.root);
      this.remotes.set(info.id, { info, model, buffer: [], lastX: 0, lastZ: 0, lastSeen: 0 });
    }
  }

  private remove(id: string, remote: Remote): void {
    this.group.remove(remote.model.root);
    remote.model.dispose();
    this.remotes.delete(id);
  }

  onSnapshot(serverTime: number, states: RemotePlayerState[]): void {
    for (const [id, x, y, z, yaw, pitch, flags, held] of states) {
      const remote = this.remotes.get(id);
      if (!remote) continue;
      remote.buffer.push({ t: serverTime, x, y, z, yaw, pitch, flags, held });
      if (remote.buffer.length > 30) remote.buffer.shift();
      remote.lastSeen = serverTime;
    }
  }

  /** @param serverNow current estimated server time in ms */
  update(serverNow: number, dt: number): void {
    const renderTime = serverNow - INTERPOLATION_DELAY_MS;
    for (const remote of this.remotes.values()) {
      const buf = remote.buffer;
      const model = remote.model;
      // Hide players that left our interest range (no snapshots for a while).
      if (buf.length === 0 || serverNow - remote.lastSeen > 1500 || remote.info.gameMode === 'spectator') {
        model.root.visible = false;
        continue;
      }
      while (buf.length > 2 && buf[1].t <= renderTime) buf.shift();
      let s: Snapshot;
      if (buf.length >= 2 && buf[0].t <= renderTime) {
        const a = buf[0];
        const b = buf[1];
        const t = b.t === a.t ? 1 : Math.min(1, (renderTime - a.t) / (b.t - a.t));
        s = {
          t: renderTime,
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
          yaw: lerpAngle(a.yaw, b.yaw, t),
          pitch: a.pitch + (b.pitch - a.pitch) * t,
          flags: b.flags,
          held: b.held,
        };
      } else {
        s = buf[0];
      }
      model.root.visible = true;
      model.root.position.set(s.x, s.y, s.z);
      model.root.rotation.y = s.yaw;
      const speed = dt > 0 ? Math.hypot(s.x - remote.lastX, s.z - remote.lastZ) / dt : 0;
      remote.lastX = s.x;
      remote.lastZ = s.z;
      if (s.flags & PlayerFlags.Swinging) model.triggerSwing();
      model.setHeldItem(s.held);
      model.animate(dt, speed, s.pitch, (s.flags & PlayerFlags.Crouching) !== 0, (s.flags & PlayerFlags.Flying) !== 0);
    }
  }

  get count(): number {
    return this.remotes.size;
  }

  dispose(): void {
    for (const [id, remote] of this.remotes) this.remove(id, remote);
  }
}

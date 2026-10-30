import { B } from '../blocks/ids';
import { getBlock, OCCLUDES } from '../blocks/registry';
import { lookDirection } from '../blocks/placement';
import { ChunkManager } from '../chunks/ChunkManager';
import { InputManager, type InputAction } from '../input/InputManager';
import { getMaxStack } from '../items/items';
import { eyeHeight } from '../physics/player';
import { LocalPlayer } from '../player/LocalPlayer';
import { PlayerModel } from '../player/PlayerModel';
import { RemotePlayers } from '../player/RemotePlayers';
import { Renderer, type RendererSettings } from '../renderer/Renderer';
import { BIOME_NAMES, TerrainGenerator } from '../terrain/generator';
import { UNLOADED } from '../world/blockAccess';
import { DAY_LENGTH_TICKS, PHYSICS_DT, WORLD_HEIGHT, WORLD_TICKS_PER_SECOND } from '../world/constants';
import { raycastBlocks } from '../world/raycast';
import { SoundPlayer } from '../audio/sounds';
import { Interaction } from './Interaction';
import type { NetworkClient } from '../../network/client/NetworkClient';
import type { BlockChangeWire, ServerMessageOf, WeatherWire } from '../../network/protocol/messages';
import { useGame } from '@/stores/game';
import { useSettings, type SettingsState } from '@/stores/settings';
import { useConnection } from '@/stores/connection';

const MAX_STEPS_PER_FRAME = 5;
const HUD_INTERVAL_MS = 200;
const FACINGS = ['North', 'West', 'South', 'East'];

export interface GameOptions {
  container: HTMLElement;
  net: NetworkClient;
  metadata: ServerMessageOf<'world:metadata'>;
}

/**
 * Client game engine: connects input, prediction, networking, chunk streaming
 * and rendering in a fixed-timestep loop. UI state flows to React through the
 * Zustand game store; React never touches the simulation directly.
 */
export class Game {
  private readonly net: NetworkClient;
  private readonly renderer: Renderer;
  private readonly chunks: ChunkManager;
  private readonly local: LocalPlayer;
  private readonly remotes: RemotePlayers;
  private readonly input: InputManager;
  private readonly interaction: Interaction;
  private readonly sounds = new SoundPlayer();
  private readonly generator: TerrainGenerator;
  private readonly selfModel: PlayerModel;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly worldId: string;
  private frameHandle = 0;
  private lastFrame = 0;
  private accumulator = 0;
  private lastHud = 0;
  private frames = 0;
  private fpsTime = 0;
  private fps = 0;
  private frameMs = 0;
  private worldTime = 0;
  private worldTimeAt = 0;
  private dayNightCycle = true;
  private weather: WeatherWire = 'clear';
  private ready = false;
  private disposed = false;
  private cameraMode: 0 | 1 | 2 = 0;
  private settingsSnapshot: SettingsState;
  private readonly resizeObserver: ResizeObserver;

  constructor(options: GameOptions) {
    this.net = options.net;
    const meta = options.metadata;
    this.worldId = meta.world.id;
    const settings = useSettings.getState();
    this.settingsSnapshot = settings;
    this.renderer = new Renderer(options.container, this.rendererSettings(settings));
    this.sounds.volume = settings.volume;
    this.generator = new TerrainGenerator(meta.world.seed, meta.world.terrainType);
    this.chunks = new ChunkManager(
      this.renderer,
      {
        requestChunks: (chunks) => this.net.send({ type: 'world:chunk-request', worldId: this.worldId, chunks }),
        releaseChunks: (chunks) => this.net.send({ type: 'world:chunk-release', worldId: this.worldId, chunks }),
      },
      meta.world.seed,
      meta.world.terrainType,
      settings.renderDistance,
    );
    this.local = new LocalPlayer(this.chunks.store);
    this.remotes = new RemotePlayers(this.renderer.materials);
    this.renderer.scene.add(this.remotes.group);
    const self = meta.players.find((p) => p.id === this.net.playerId);
    this.selfModel = new PlayerModel(self?.name ?? 'You', self?.appearance ?? { skin: '#d9a066', shirt: '#3b7dd8', pants: '#3a3a5c' }, this.renderer.materials);
    this.selfModel.setLabelVisible(false);
    this.selfModel.root.visible = false;
    this.renderer.scene.add(this.selfModel.root);

    this.input = new InputManager(this.renderer.domElement, (action, value) => this.onInput(action, value));
    this.interaction = new Interaction({
      world: this.chunks.store,
      worldId: this.worldId,
      send: (msg) => this.net.send(msg),
      applyLocal: (changes) => this.chunks.applyBlockChanges(changes, true),
      heldItem: () => {
        const inv = useGame.getState().inventory;
        return inv?.slots[inv.selectedSlot]?.id ?? 0;
      },
      gameMode: () => this.local.mode,
      canBuild: () => useGame.getState().canBuild,
      player: () => Object.assign(this.local.state, { yaw: this.local.yaw, pitch: this.local.pitch }),
      crouching: () => this.input.movement().crouch,
      onSwing: () => this.renderer.swingHand(),
      onSound: (name) => this.sounds.play(name),
      notify: (text) => useGame.getState().notify(text, 'warning'),
      pickBlock: (id) => this.pickBlock(id),
    });

    this.applyMetadata(meta);
    this.subscribe();
    this.unsubscribers.push(
      useSettings.subscribe((s) => this.onSettingsChanged(s)),
      useGame.subscribe((s, prev) => {
        if (s.panel !== prev.panel) this.onPanelChanged(s.panel);
        if (s.thirdPerson !== prev.thirdPerson && !s.thirdPerson) this.cameraMode = 0;
      }),
    );
    this.resizeObserver = new ResizeObserver(() => this.renderer.resize());
    this.resizeObserver.observe(options.container);
    useGame.getState().set({ phase: 'loading' });
  }

  start(): void {
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
  }

  // --- Setup ------------------------------------------------------------------------

  private rendererSettings(s: SettingsState): RendererSettings {
    return { fov: s.fov, renderDistance: s.renderDistance, shadows: s.shadows, quality: s.quality, particles: s.particles };
  }

  private applyMetadata(meta: ServerMessageOf<'world:metadata'>): void {
    const self = meta.self;
    this.local.mode = self.gameMode;
    this.local.reset(self.x, self.y, self.z, self.yaw, self.pitch, self.flying);
    this.worldTime = meta.time;
    this.worldTimeAt = performance.now();
    this.dayNightCycle = meta.world.dayNightCycle;
    this.weather = meta.weather;
    this.renderer.weather.setMode(meta.weather);
    this.remotes.setPlayers(meta.players, this.net.playerId);
    useGame.getState().set({
      world: meta.world,
      selfId: this.net.playerId,
      gameMode: self.gameMode,
      canBuild: self.canBuild,
      isOwner: self.isOwner,
      players: meta.players,
      inventory: meta.inventory,
    });
  }

  private subscribe(): void {
    const net = this.net;
    this.unsubscribers.push(
      net.on('world:metadata', (meta) => {
        if (meta.world.id !== this.worldId) return;
        // Re-joined after a reconnect: adopt the server state and resync chunks.
        this.applyMetadata(meta);
        this.chunks.resync();
        useGame.getState().notify('Reconnected to the world.');
      }),
      net.on('world:chunk-data', (msg) => {
        if (msg.worldId === this.worldId) void this.chunks.onChunkData(msg.cx, msg.cz, msg.revision, msg.encoding, msg.data);
      }),
      net.on('block:update', (msg) => {
        if (msg.worldId !== this.worldId) return;
        this.playChangeSounds(msg.changes, false);
        this.chunks.applyBlockChanges(msg.changes, true);
      }),
      net.on('circuit:state-update', (msg) => {
        if (msg.worldId !== this.worldId) return;
        this.playChangeSounds(msg.changes, true);
        this.chunks.applyBlockChanges(msg.changes, true);
      }),
      net.on('block:action-result', (msg) => this.interaction.onActionResult(msg)),
      net.on('player:state', (msg) => {
        if (msg.worldId === this.worldId) this.local.reconcile(msg);
      }),
      net.on('player:snapshot', (msg) => {
        if (msg.worldId === this.worldId) this.remotes.onSnapshot(msg.serverTime, msg.players);
      }),
      net.on('player:join', (msg) => {
        const players = [...useGame.getState().players.filter((p) => p.id !== msg.player.id), msg.player];
        useGame.getState().set({ players });
        this.remotes.setPlayers(players, this.net.playerId);
      }),
      net.on('player:update', (msg) => {
        const players = useGame.getState().players.map((p) => (p.id === msg.player.id ? msg.player : p));
        useGame.getState().set({ players });
        this.remotes.setPlayers(players, this.net.playerId);
        if (msg.player.id === this.net.playerId) {
          this.local.mode = msg.player.gameMode;
          useGame.getState().set({ gameMode: msg.player.gameMode, canBuild: msg.player.canBuild });
        }
      }),
      net.on('player:leave', (msg) => {
        const players = useGame.getState().players.filter((p) => p.id !== msg.playerId);
        useGame.getState().set({ players });
        this.remotes.setPlayers(players, this.net.playerId);
      }),
      net.on('world:time-update', (msg) => {
        if (msg.worldId !== this.worldId) return;
        this.worldTime = msg.time;
        this.worldTimeAt = performance.now();
        this.dayNightCycle = msg.dayNightCycle;
        if (msg.weather !== this.weather) {
          this.weather = msg.weather;
          this.renderer.weather.setMode(msg.weather);
        }
      }),
      net.on('inventory:update', (msg) => {
        if (msg.worldId === this.worldId) useGame.getState().set({ inventory: msg.inventory });
      }),
      net.on('inventory:open', (msg) => {
        if (msg.worldId !== this.worldId) return;
        useGame.getState().set({ inventoryKind: msg.kind, panel: 'inventory' });
      }),
      net.on('chat:message', (msg) => {
        if (msg.worldId !== this.worldId) return;
        if (msg.fromId && useSettings.getState().mutedPlayers.includes(msg.fromId)) return;
        useGame.getState().addChat({ id: msg.id, kind: msg.kind, fromId: msg.fromId, fromName: msg.fromName, text: msg.text, ts: msg.ts });
        if (msg.kind === 'player' && msg.fromId !== this.net.playerId) this.sounds.play('chat');
      }),
      net.on('server:notification', (msg) => useGame.getState().notify(msg.text, msg.level)),
      net.on('world:left', (msg) => {
        if (msg.worldId !== this.worldId) return;
        useGame.getState().set({ phase: 'error', error: msg.reason ?? 'You left the world.' });
        this.input.exitPointerLock();
      }),
      net.on('server:shutdown', (msg) => {
        useGame.getState().notify(msg.reason, 'warning');
      }),
      net.onStatus((status, error) => {
        useConnection.getState().setStatus(status, error);
        if (status !== 'connected') this.interaction.releaseAll();
      }),
    );
  }

  private playChangeSounds(changes: BlockChangeWire[], circuit: boolean): void {
    const p = this.local.state;
    let played = false;
    for (const [x, y, z, id] of changes) {
      if (played) break;
      if (Math.hypot(x - p.x, y - p.y, z - p.z) > 16) continue;
      if (circuit) {
        if (id === B.PISTON_ARM || id === B.IRON_PANEL) this.sounds.play('piston');
        else if (id === B.DOOR || id === B.TRAPDOOR) this.sounds.play('door');
        else continue;
      } else {
        const old = this.chunks.store.getBlock(x, y, z);
        if (old === id) continue;
        this.sounds.play(id === B.AIR ? 'break' : 'place');
      }
      played = true;
    }
  }

  // --- Input -----------------------------------------------------------------------------

  private onInput(action: InputAction, value?: number): void {
    const game = useGame.getState();
    switch (action) {
      case 'pause':
        if (game.panel) game.openPanel(game.panel === 'settings' ? 'pause' : null);
        else if (this.ready) game.openPanel('pause');
        break;
      case 'inventory':
        if (game.panel === 'inventory') this.closeInventory();
        else if (!game.panel && this.local.mode !== 'spectator') {
          game.set({ inventoryKind: 'inventory' });
          game.openPanel('inventory');
        }
        break;
      case 'chat':
        game.openPanel('chat');
        break;
      case 'command':
        game.openPanel('chat', '/');
        break;
      case 'players':
        game.openPanel(game.panel === 'players' ? null : 'players');
        break;
      case 'debug':
        useSettings.getState().set({ showDebug: !useSettings.getState().showDebug });
        break;
      case 'camera':
        this.cameraMode = ((this.cameraMode + 1) % 3) as 0 | 1 | 2;
        game.set({ thirdPerson: this.cameraMode !== 0 });
        break;
      case 'toggleFly':
        if (this.local.mode === 'creative') this.local.wantsFly = !this.local.wantsFly;
        break;
      case 'primaryDown':
        this.interaction.primary(true);
        break;
      case 'primaryUp':
        this.interaction.primary(false);
        break;
      case 'secondaryDown':
        this.interaction.secondary(true);
        break;
      case 'secondaryUp':
        this.interaction.secondary(false);
        break;
      case 'pick':
        this.interaction.pick();
        break;
      case 'hotbar':
        if (value !== undefined) this.selectSlot(value);
        break;
      case 'hotbarScroll': {
        const inv = game.inventory;
        if (inv && value) this.selectSlot((inv.selectedSlot + (value > 0 ? 1 : 8)) % 9);
        break;
      }
    }
  }

  private onPanelChanged(panel: ReturnType<typeof useGame.getState>['panel']): void {
    this.input.gameplayEnabled = panel === null;
    if (panel) {
      this.interaction.releaseAll();
      this.input.exitPointerLock();
    }
  }

  closeInventory(): void {
    this.net.send({ type: 'inventory:close', worldId: this.worldId });
    useGame.getState().openPanel(null);
  }

  selectSlot(slot: number): void {
    const game = useGame.getState();
    if (!game.inventory || slot < 0 || slot > 8) return;
    game.set({ inventory: { ...game.inventory, selectedSlot: slot } });
    this.net.send({ type: 'inventory:select', worldId: this.worldId, slot });
  }

  private pickBlock(id: number): void {
    const inv = useGame.getState().inventory;
    if (!inv) return;
    const existing = inv.slots.findIndex((s, i) => i < 9 && s?.id === id);
    if (existing >= 0) {
      this.selectSlot(existing);
      return;
    }
    this.net.send({ type: 'inventory:creative-set', worldId: this.worldId, slot: inv.selectedSlot, item: id, count: getMaxStack(id) });
  }

  /** Called by touch controls and UI buttons. */
  get controls(): InputManager {
    return this.input;
  }

  get actions(): Interaction {
    return this.interaction;
  }

  requestPointerLock(): void {
    this.input.requestPointerLock();
  }

  private onSettingsChanged(s: SettingsState): void {
    const prev = this.settingsSnapshot;
    this.settingsSnapshot = s;
    this.sounds.volume = s.volume;
    if (s.renderDistance !== prev.renderDistance) {
      this.chunks.setRenderDistance(s.renderDistance);
      this.net.send({ type: 'world:render-distance', worldId: this.worldId, renderDistance: s.renderDistance });
    }
    if (s.fov !== prev.fov || s.shadows !== prev.shadows || s.quality !== prev.quality || s.particles !== prev.particles || s.renderDistance !== prev.renderDistance) {
      this.renderer.applySettings(this.rendererSettings(s));
    }
  }

  // --- Frame loop --------------------------------------------------------------------------

  private frame(now: number): void {
    if (this.disposed) return;
    this.frameHandle = requestAnimationFrame((t) => this.frame(t));
    const limit = this.settingsSnapshot.fpsLimit;
    if (limit > 0 && now - this.lastFrame < 1000 / limit - 1) return;
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const started = performance.now();

    this.applyLook();
    const areaReady = this.chunks.isAreaReady(this.local.state.x, this.local.state.z);
    if (areaReady && !this.ready) {
      this.ready = true;
      useGame.getState().set({ phase: 'playing' });
    }
    if (areaReady && this.net.isConnected) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= PHYSICS_DT && steps < MAX_STEPS_PER_FRAME) {
        const input = this.local.step(this.input.movement());
        this.net.send({ type: 'player:input', worldId: this.worldId, inputs: [input] });
        this.accumulator -= PHYSICS_DT;
        steps++;
      }
      if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    }

    const alpha = Math.min(1, this.accumulator / PHYSICS_DT);
    const pos = this.local.renderPosition(alpha, dt);
    const eye: [number, number, number] = [pos.x, pos.y + eyeHeight(this.local.state), pos.z];
    const look = lookDirection(this.local.yaw, this.local.pitch);
    this.placeCamera(eye, look, pos);

    this.chunks.update(pos.x, pos.z);
    if (this.ready) this.interaction.update(dt, eye, look);
    this.renderer.selection.setTarget(this.interaction.target);
    this.renderer.selection.setProgress(this.interaction.progress > 0 ? this.interaction.progress : null);
    this.remotes.update(this.net.clock.now(), dt);

    const inv = useGame.getState().inventory;
    const held = inv?.slots[inv.selectedSlot]?.id ?? 0;
    this.renderer.setHeldItem(held, this.cameraMode === 0 && this.local.mode !== 'spectator');
    this.selfModel.setHeldItem(held);

    const timeOfDay = this.timeOfDay();
    const camBlock = this.chunks.store.getBlock(eye[0], eye[1], eye[2]);
    const underwater = camBlock === B.WATER;
    this.renderer.render(dt, timeOfDay, this.weather, this.isSheltered(eye), underwater);

    this.frameMs = this.frameMs * 0.9 + (performance.now() - started) * 0.1;
    this.frames++;
    if (now - this.fpsTime >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsTime));
      this.frames = 0;
      this.fpsTime = now;
    }
    if (now - this.lastHud >= HUD_INTERVAL_MS) {
      this.lastHud = now;
      this.publishHud(pos, timeOfDay, underwater);
    }
  }

  private applyLook(): void {
    const { dx, dy } = this.input.consumeLook();
    if (dx === 0 && dy === 0) return;
    const s = this.settingsSnapshot;
    const factor = 0.0022 * s.mouseSensitivity;
    this.local.yaw -= dx * factor;
    this.local.pitch -= dy * factor * (s.invertY ? -1 : 1);
    this.local.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.local.pitch));
    this.local.yaw = ((this.local.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  private placeCamera(eye: [number, number, number], look: [number, number, number], pos: { x: number; y: number; z: number }): void {
    const camera = this.renderer.camera;
    const state = this.local.state;
    this.selfModel.root.visible = this.cameraMode !== 0 && this.local.mode !== 'spectator';
    if (this.selfModel.root.visible) {
      this.selfModel.root.position.set(pos.x, pos.y, pos.z);
      this.selfModel.root.rotation.y = this.local.yaw;
      this.selfModel.animate(1 / 60, Math.hypot(state.vx, state.vz), this.local.pitch, state.crouching, state.flying);
    }
    if (this.cameraMode === 0) {
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.rotation.set(this.local.pitch, this.local.yaw, 0);
      return;
    }
    // Third person: back the camera away from the eye, stopping at walls.
    const dir = this.cameraMode === 1 ? [-look[0], -look[1], -look[2]] : look;
    const hit = raycastBlocks(this.chunks.store, eye, dir as [number, number, number], 4.5);
    const distance = hit ? Math.max(0.3, hit.distance - 0.3) : 4;
    camera.position.set(eye[0] + dir[0] * distance, eye[1] + dir[1] * distance, eye[2] + dir[2] * distance);
    camera.lookAt(eye[0], eye[1], eye[2]);
  }

  private timeOfDay(): number {
    const elapsed = this.dayNightCycle ? ((performance.now() - this.worldTimeAt) / 1000) * WORLD_TICKS_PER_SECOND : 0;
    return (this.worldTime + elapsed) % DAY_LENGTH_TICKS;
  }

  private isSheltered(eye: [number, number, number]): boolean {
    for (let y = Math.floor(eye[1]) + 1; y < Math.min(WORLD_HEIGHT, eye[1] + 40); y++) {
      const id = this.chunks.store.getBlock(eye[0], y, eye[2]);
      if (id !== UNLOADED && OCCLUDES[id]) return true;
    }
    return false;
  }

  private publishHud(pos: { x: number; y: number; z: number }, timeOfDay: number, underwater: boolean): void {
    const stats = this.chunks.stats;
    const yawIndex = Math.round(this.local.yaw / (Math.PI / 2)) % 4;
    const target = this.interaction.target;
    useGame.getState().setHud({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      facing: FACINGS[(yawIndex + 4) % 4],
      biome: BIOME_NAMES[this.generator.getColumn(Math.floor(pos.x), Math.floor(pos.z)).biome],
      fps: this.fps,
      frameMs: this.frameMs,
      chunksLoaded: stats.loaded,
      chunksMeshed: stats.meshed,
      drawCalls: this.renderer.drawCalls,
      triangles: this.renderer.triangles,
      meshMs: this.chunks.lastMeshMs,
      target: target ? getBlock(target.id).displayName : null,
      timeOfDay,
      weather: this.weather,
      breakProgress: this.interaction.progress,
      flying: this.local.state.flying,
      underwater,
    });
    useConnection.getState().setLatency(Math.round(this.net.clock.latency));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    for (const off of this.unsubscribers) off();
    this.input.dispose();
    this.chunks.dispose();
    this.remotes.dispose();
    this.selfModel.dispose();
    this.sounds.dispose();
    this.renderer.dispose();
  }
}


import { decodeServerMessage, encodeClientMessage } from '../protocol/codec';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type ServerMessageOf,
  type ServerMessageType,
} from '../protocol/messages';
import { ServerClock } from '../synchronization/clock';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';

type Handler<T extends ServerMessageType> = (message: ServerMessageOf<T>) => void;

export interface JoinRequest {
  worldId: string;
  password?: string;
  renderDistance: number;
}

const MAX_RECONNECT_ATTEMPTS = 12;
const PING_INTERVAL_MS = 2000;
const CONNECT_TIMEOUT_MS = 8000;

/** WebSocket URL for the current page, using wss:// behind HTTPS. */
export function resolveWebSocketUrl(): string {
  const { protocol, host } = window.location;
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws`;
}

/**
 * Browser WebSocket client with typed message handlers, heartbeats, clock
 * synchronisation and automatic reconnection (re-joining the current world).
 */
export class NetworkClient {
  private ws: WebSocket | null = null;
  private readonly handlers = new Map<ServerMessageType, Set<(m: ServerMessage) => void>>();
  private readonly statusListeners = new Set<(status: ConnectionStatus, error: string | null) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wantConnected = false;
  private connectPromise: Promise<void> | null = null;
  private fatalError: string | null = null;
  readonly clock = new ServerClock();
  status: ConnectionStatus = 'idle';
  lastError: string | null = null;
  playerId: string | null = null;
  displayName: string | null = null;
  /** World to re-join automatically after a reconnect. */
  currentJoin: JoinRequest | null = null;

  on<T extends ServerMessageType>(type: T, handler: Handler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as (m: ServerMessage) => void);
    return () => set.delete(handler as (m: ServerMessage) => void);
  }

  onStatus(listener: (status: ConnectionStatus, error: string | null) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status, this.lastError);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: ConnectionStatus, error: string | null = null): void {
    this.status = status;
    this.lastError = error;
    for (const l of this.statusListeners) l(status, error);
  }

  get isConnected(): boolean {
    return this.status === 'connected';
  }

  /** Connect (if needed) and resolve once the server welcomed us. */
  connect(): Promise<void> {
    this.wantConnected = true;
    if (this.status === 'connected') return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;
    this.fatalError = null;
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const offWelcome = this.on('connection:welcome', () => {
        cleanup();
        resolve();
      });
      const offStatus = this.onStatus((status, error) => {
        if (status === 'failed') {
          cleanup();
          reject(new Error(error ?? 'Connection failed'));
        }
      });
      const cleanup = () => {
        offWelcome();
        offStatus();
        this.connectPromise = null;
      };
      this.open();
    });
    return this.connectPromise;
  }

  private open(): void {
    if (this.ws) return;
    this.setStatus(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(resolveWebSocketUrl());
    } catch (error) {
      this.setStatus('failed', error instanceof Error ? error.message : 'Could not open a connection');
      return;
    }
    this.ws = ws;
    const timeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) ws.close();
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(timeout);
      this.sendNow({ type: 'connection:hello', protocol: PROTOCOL_VERSION, client: 'blockhaven-web' });
    };
    ws.onmessage = (event) => {
      const message = decodeServerMessage(typeof event.data === 'string' ? event.data : '');
      if (message) this.dispatch(message);
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      this.ws = null;
      this.stopPing();
      if (this.fatalError) {
        this.setStatus('failed', this.fatalError);
        return;
      }
      if (!this.wantConnected) {
        this.setStatus('disconnected');
        return;
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose follows and handles retries.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      void this.diagnoseFailure();
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(8000, 400 * 2 ** (this.reconnectAttempts - 1));
    this.setStatus('reconnecting', `Connection lost. Retrying (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /** Give a clear reason when we cannot connect at all. */
  private async diagnoseFailure(): Promise<void> {
    let reason = 'Could not reach the game server. Check that it is running and that you are on the same network.';
    try {
      const res = await fetch('/api/session', { cache: 'no-store' });
      if (res.ok) {
        const body = (await res.json()) as { player: unknown };
        if (!body.player) reason = 'Your player session has expired. Create your profile again.';
      }
    } catch {
      // Server unreachable; keep the generic message.
    }
    this.setStatus('failed', reason);
  }

  private dispatch(message: ServerMessage): void {
    switch (message.type) {
      case 'connection:welcome':
        this.reconnectAttempts = 0;
        this.playerId = message.playerId;
        this.displayName = message.displayName;
        this.clock.reset();
        this.clock.addSample(Date.now(), message.serverTime);
        this.setStatus('connected');
        this.startPing();
        if (this.currentJoin) this.sendJoin(this.currentJoin);
        break;
      case 'connection:pong':
        this.clock.addSample(message.t, message.serverTime);
        break;
      case 'connection:error':
        if (message.fatal) this.fatalError = message.message;
        break;
      case 'server:shutdown':
        this.fatalError = null;
        break;
      default:
        break;
    }
    const set = this.handlers.get(message.type);
    if (set) for (const handler of [...set]) handler(message);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => this.sendNow({ type: 'connection:ping', t: Date.now() }), PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private sendNow(message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(encodeClientMessage(message));
    return true;
  }

  /** Send a message if connected (messages are dropped while reconnecting). */
  send(message: ClientMessage): boolean {
    if (this.status !== 'connected') return false;
    return this.sendNow(message);
  }

  private sendJoin(join: JoinRequest): void {
    this.sendNow({ type: 'world:join', worldId: join.worldId, renderDistance: join.renderDistance, ...(join.password ? { password: join.password } : {}) });
  }

  /** Join a world and resolve with its metadata, or reject with the server's reason. */
  async joinWorld(join: JoinRequest): Promise<ServerMessageOf<'world:metadata'>> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const offMeta = this.on('world:metadata', (meta) => {
        if (meta.world.id !== join.worldId) return;
        cleanup();
        this.currentJoin = join;
        resolve(meta);
      });
      const offError = this.on('connection:error', (err) => {
        if (!['world_not_found', 'world_full', 'wrong_password', 'server_error'].includes(err.code)) return;
        cleanup();
        reject(Object.assign(new Error(err.message), { code: err.code }));
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('The server did not respond in time.'));
      }, 20000);
      const cleanup = () => {
        offMeta();
        offError();
        clearTimeout(timer);
      };
      this.sendJoin(join);
    });
  }

  leaveWorld(): void {
    this.currentJoin = null;
    this.send({ type: 'world:leave' });
  }

  disconnect(): void {
    this.wantConnected = false;
    this.currentJoin = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.ws?.close();
  }

  /** Manually retry after a failure. */
  retry(): Promise<void> {
    this.reconnectAttempts = 0;
    this.fatalError = null;
    this.setStatus('idle');
    return this.connect();
  }
}

let instance: NetworkClient | null = null;

/** Shared client; survives client-side navigation between pages. */
export function getNetworkClient(): NetworkClient {
  if (!instance) instance = new NetworkClient();
  return instance;
}

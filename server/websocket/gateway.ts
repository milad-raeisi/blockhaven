import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { decodeClientMessage } from '../../src/network/protocol/codec';
import { MAX_CLIENT_MESSAGE_BYTES, PROTOCOL_VERSION, type ClientMessage } from '../../src/network/protocol/messages';
import type { ServerConfig } from '../lib/config';
import type { Logger } from '../lib/logger';
import type { RoomManager } from '../rooms/RoomManager';
import { isOriginAllowed } from '../security/origin';
import { categoryFor } from '../security/rateLimiter';
import { parseAppearance, type SessionService } from '../sessions/sessionService';
import { ClientConnection } from './connection';

export const WS_PATH = '/ws';
const HELLO_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 10_000;
const MAX_INVALID_MESSAGES = 25;
const MAX_RATE_VIOLATIONS = 200;

export interface GatewayDeps {
  sessions: SessionService;
  rooms: RoomManager;
  config: ServerConfig;
  log: Logger;
}

/** Accepts authenticated WebSocket upgrades on /ws and routes protocol messages. */
export class WebSocketGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CLIENT_MESSAGE_BYTES, perMessageDeflate: false });
  private readonly connections = new Set<ClientConnection>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly log: Logger;

  constructor(private readonly deps: GatewayDeps) {
    this.log = deps.log.child('ws');
    this.heartbeat = setInterval(() => this.checkHeartbeats(), HEARTBEAT_MS);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** Handle an HTTP upgrade. Returns false if the path is not ours (e.g. Next.js HMR). */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const path = (req.url ?? '').split('?')[0];
    if (path !== WS_PATH) return false;
    void this.authenticateAndUpgrade(req, socket, head);
    return true;
  }

  private async authenticateAndUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!isOriginAllowed(req, this.deps.config.allowedOrigins)) {
      this.log.warn('Rejected WebSocket origin', { origin: req.headers.origin ?? '' });
      return reject(403, 'Forbidden');
    }
    let player;
    try {
      player = await this.deps.sessions.playerFromRequest(req);
    } catch (error) {
      this.log.error('Session lookup failed', { error: error as Error });
      return reject(500, 'Internal Server Error');
    }
    if (!player) return reject(401, 'Unauthorized');
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = new ClientConnection(
        ws,
        { id: player.id, displayName: player.displayName, appearance: parseAppearance(player.appearance) },
        req.socket.remoteAddress ?? 'unknown',
      );
      this.onConnection(conn, ws);
    });
  }

  private onConnection(conn: ClientConnection, ws: WebSocket): void {
    this.connections.add(conn);
    this.log.info('Client connected', { player: conn.account.displayName, address: conn.remoteAddress, connections: this.connections.size });
    const helloTimer = setTimeout(() => {
      if (!conn.helloReceived) conn.close(4000, 'Handshake timeout');
    }, HELLO_TIMEOUT_MS);

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        conn.send({ type: 'connection:error', code: 'invalid_message', message: 'Binary messages are not supported' });
        return;
      }
      this.onMessage(conn, data.toString());
    });
    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      this.connections.delete(conn);
      this.deps.rooms.unsubscribeLobby(conn);
      this.deps.rooms.leave(conn, code === 1006 ? 'timeout' : 'disconnected');
      this.log.info('Client disconnected', { player: conn.account.displayName, code, connections: this.connections.size });
    });
    ws.on('error', (error) => this.log.warn('Socket error', { player: conn.account.displayName, error }));
  }

  private onMessage(conn: ClientConnection, raw: string): void {
    const decoded = decodeClientMessage(raw);
    if (!decoded.ok) {
      conn.invalidMessages++;
      conn.send({ type: 'connection:error', code: 'invalid_message', message: decoded.error });
      if (conn.invalidMessages > MAX_INVALID_MESSAGES) conn.close(4002, 'Too many invalid messages');
      return;
    }
    const msg = decoded.message;
    if (!conn.limiter.allow(categoryFor(msg.type))) {
      if (msg.type === 'chat:send') conn.send({ type: 'server:notification', level: 'warning', text: 'You are sending messages too quickly.' });
      if (conn.limiter.violations > MAX_RATE_VIOLATIONS) {
        conn.send({ type: 'connection:error', code: 'rate_limited', message: 'Too many requests', fatal: true });
        conn.close(4003, 'Rate limit exceeded');
      }
      return;
    }
    try {
      this.route(conn, msg);
    } catch (error) {
      this.log.error('Message handler failed', { type: msg.type, error: error as Error });
      conn.send({ type: 'connection:error', code: 'server_error', message: 'The server could not process that request.' });
    }
  }

  private route(conn: ClientConnection, msg: ClientMessage): void {
    if (msg.type === 'connection:hello') {
      if (msg.protocol !== PROTOCOL_VERSION) {
        conn.send({
          type: 'connection:error',
          code: 'protocol_mismatch',
          message: `Protocol version ${msg.protocol} is not supported (server uses ${PROTOCOL_VERSION}). Refresh the page.`,
          fatal: true,
        });
        conn.close(4001, 'Protocol mismatch');
        return;
      }
      conn.helloReceived = true;
      conn.send({
        type: 'connection:welcome',
        protocol: PROTOCOL_VERSION,
        playerId: conn.account.id,
        displayName: conn.account.displayName,
        appearance: conn.account.appearance,
        serverTime: Date.now(),
        tickRate: this.deps.config.TICK_RATE,
        maxRenderDistance: this.deps.config.MAX_RENDER_DISTANCE,
      });
      return;
    }
    if (!conn.helloReceived) {
      conn.send({ type: 'connection:error', code: 'invalid_message', message: 'Send connection:hello first' });
      return;
    }
    switch (msg.type) {
      case 'connection:ping':
        conn.send({ type: 'connection:pong', t: msg.t, serverTime: Date.now() });
        return;
      case 'lobby:subscribe':
        this.deps.rooms.subscribeLobby(conn);
        return;
      case 'lobby:unsubscribe':
        this.deps.rooms.unsubscribeLobby(conn);
        return;
      case 'world:join':
        conn.worldQueue = conn.worldQueue.then(() => this.join(conn, msg));
        return;
      case 'world:leave':
        conn.worldQueue = conn.worldQueue.then(() => {
          if (!conn.room) return;
          const worldId = conn.room.id;
          this.deps.rooms.leave(conn, 'left');
          conn.send({ type: 'world:left', worldId });
        });
        return;
      default:
        break;
    }
    if (!conn.room || !conn.player) {
      conn.send({ type: 'connection:error', code: 'not_in_world', message: 'Join a world first' });
      return;
    }
    // Room isolation: messages must target the world this connection is in.
    if ('worldId' in msg && msg.worldId !== conn.room.id) {
      conn.send({ type: 'connection:error', code: 'invalid_message', message: 'Message targets a different world' });
      return;
    }
    conn.room.handleMessage(conn.player, msg);
  }

  private async join(conn: ClientConnection, msg: Extract<ClientMessage, { type: 'world:join' }>): Promise<void> {
    if (!conn.isOpen) return;
    try {
      if (conn.room) this.deps.rooms.leave(conn, 'switched worlds');
      const result = await this.deps.rooms.join(conn, msg);
      if (!result.ok) conn.send({ type: 'connection:error', code: result.error.code, message: result.error.message });
    } catch (error) {
      this.log.error('Join failed', { error: error as Error });
      conn.send({ type: 'connection:error', code: 'server_error', message: 'Could not join the world.' });
    }
  }

  private checkHeartbeats(): void {
    for (const conn of this.connections) {
      if (!conn.alive) {
        this.log.info('Heartbeat timeout', { player: conn.account.displayName });
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        conn.ws.ping();
      } catch {
        conn.ws.terminate();
      }
    }
  }

  /** Disconnect everyone with a shutdown notice. */
  async shutdown(reason: string): Promise<void> {
    clearInterval(this.heartbeat);
    for (const conn of this.connections) {
      conn.send({ type: 'server:shutdown', reason });
      conn.close(1001, 'Server shutting down');
    }
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

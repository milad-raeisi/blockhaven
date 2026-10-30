import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { ApiRouter } from './http/api';
import { sendJson } from './http/json';
import type { ServerConfig } from './lib/config';
import { createLogger } from './lib/logger';
import { disconnectPrisma, getPrisma } from './persistence/prisma';
import { WorldRepository } from './persistence/worldRepository';
import { RoomManager } from './rooms/RoomManager';
import { SessionService } from './sessions/sessionService';
import { WebSocketGateway } from './websocket/gateway';

export interface WebHandlers {
  request: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void;
  upgrade?: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void> | void;
}

export interface GameServer {
  server: Server;
  rooms: RoomManager;
  gateway: WebSocketGateway;
  listen(): Promise<{ port: number }>;
  stop(reason?: string): Promise<void>;
}

/**
 * Build the HTTP server: REST API under /api, multiplayer WebSockets on /ws,
 * and everything else forwarded to Next.js (when `web` is provided).
 */
export function createGameServer(config: ServerConfig, web?: WebHandlers, version = '1.0.0'): GameServer {
  const log = createLogger('server');
  const prisma = getPrisma(config.DATABASE_URL);
  const repo = new WorldRepository(prisma);
  const sessions = new SessionService(prisma, config.SESSION_SECRET, config.SECURE_COOKIES);
  const rooms = new RoomManager({ repo, config, log });
  const gateway = new WebSocketGateway({ sessions, rooms, config, log });
  const api = new ApiRouter({ prisma, repo, sessions, rooms, config, log, version });

  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (await api.handle(req, res)) return;
        if (web) await web.request(req, res);
        else sendJson(res, 404, { error: 'Not found' });
      } catch (error) {
        log.error('Request failed', { url: req.url ?? '', error: error as Error });
        if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
        else res.end();
      }
    })();
  });

  server.on('upgrade', (req, socket, head) => {
    if (gateway.handleUpgrade(req, socket, head)) return;
    // Anything else (e.g. Next.js hot reload in development) goes to Next.
    if (web?.upgrade) void web.upgrade(req, socket, head);
    else socket.destroy();
  });

  let stopping: Promise<void> | null = null;

  return {
    server,
    rooms,
    gateway,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.PORT, config.HOST, () => {
          server.off('error', reject);
          const address = server.address();
          resolve({ port: typeof address === 'object' && address ? address.port : config.PORT });
        });
      }),
    stop: (reason = 'The server is shutting down.') => {
      stopping ??= (async () => {
        log.info('Shutting down: saving worlds and disconnecting players');
        server.close();
        await rooms.shutdown(reason);
        await gateway.shutdown(reason);
        server.closeAllConnections?.();
        await disconnectPrisma();
        log.info('Shutdown complete');
      })();
      return stopping;
    },
  };
}

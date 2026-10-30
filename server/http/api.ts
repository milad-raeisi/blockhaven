import { randomInt } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Player, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { TERRAIN_TYPES } from '../../src/game/terrain/generator';
import type { ServerConfig } from '../lib/config';
import type { Logger } from '../lib/logger';
import { getLanUrls } from '../lib/network';
import type { WorldRepository } from '../persistence/worldRepository';
import type { RoomManager } from '../rooms/RoomManager';
import { isOriginAllowed } from '../security/origin';
import { hashPassword } from '../security/passwords';
import { TokenBucket } from '../security/rateLimiter';
import { sanitizeDisplayName, sanitizeWorldName } from '../security/sanitize';
import { DEFAULT_APPEARANCE, parseAppearance, type SessionService } from '../sessions/sessionService';
import { HttpError, readJsonBody, sendJson } from './json';

export interface ApiDeps {
  prisma: PrismaClient;
  repo: WorldRepository;
  sessions: SessionService;
  rooms: RoomManager;
  config: ServerConfig;
  log: Logger;
  version: string;
}

const appearanceSchema = z.object({ skin: z.string(), shirt: z.string(), pants: z.string() }).partial();

const sessionSchema = z.object({ displayName: z.string().max(32), appearance: appearanceSchema.optional() });
const profileSchema = z.object({ displayName: z.string().max(32).optional(), appearance: appearanceSchema.optional() });

const createWorldSchema = z.object({
  name: z.string().max(64),
  seed: z.string().max(64).optional().default(''),
  gameMode: z.enum(['creative', 'survival', 'spectator']).default('creative'),
  visibility: z.enum(['public', 'unlisted', 'private']).default('public'),
  maxPlayers: z.number().int().min(1).max(16).default(8),
  password: z.string().max(64).optional().default(''),
  terrainType: z.enum(TERRAIN_TYPES as [string, ...string[]]).default('default'),
  dayNightCycle: z.boolean().default(true),
  weatherEnabled: z.boolean().default(true),
  buildPermission: z.enum(['everyone', 'members', 'owner']).default('everyone'),
  includeShowcase: z.boolean().default(true),
});

function publicPlayer(p: Player) {
  return { id: p.id, displayName: p.displayName, appearance: parseAppearance(p.appearance) };
}

/** JSON REST endpoints served by the custom server under /api. */
export class ApiRouter {
  private readonly createLimiter = new Map<string, TokenBucket>();

  constructor(private readonly deps: ApiDeps) {}

  /** Returns true if the request was handled. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    const method = req.method ?? 'GET';
    try {
      if (method !== 'GET' && method !== 'HEAD' && !isOriginAllowed(req, this.deps.config.allowedOrigins)) {
        throw new HttpError(403, 'Cross-origin request rejected');
      }
      const path = url.pathname;
      if (path === '/api/health' && method === 'GET') return this.ok(res, { status: 'ok' });
      if (path === '/api/server-info' && method === 'GET') return this.ok(res, this.serverInfo());
      if (path === '/api/session' && method === 'GET') return this.ok(res, await this.getSession(req));
      if (path === '/api/session' && method === 'POST') return await this.createSession(req, res);
      if (path === '/api/session' && method === 'DELETE') return await this.logout(req, res);
      if (path === '/api/profile' && method === 'PATCH') return this.ok(res, await this.updateProfile(req));
      if (path === '/api/worlds' && method === 'GET') return this.ok(res, await this.listWorlds(req));
      if (path === '/api/worlds' && method === 'POST') return this.created(res, await this.createWorld(req));
      const match = /^\/api\/worlds\/([A-Za-z0-9_-]{1,40})$/.exec(path);
      if (match && method === 'GET') return this.ok(res, await this.getWorld(req, match[1]));
      if (match && method === 'DELETE') return this.ok(res, await this.deleteWorld(req, match[1]));
      throw new HttpError(404, 'Not found');
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        this.deps.log.error('API request failed', { path: url.pathname, error: error as Error });
        sendJson(res, 500, { error: 'Internal server error' });
      }
      return true;
    }
  }

  private ok(res: ServerResponse, body: unknown): true {
    sendJson(res, 200, body);
    return true;
  }

  private created(res: ServerResponse, body: unknown): true {
    sendJson(res, 201, body);
    return true;
  }

  private async requirePlayer(req: IncomingMessage): Promise<Player> {
    const player = await this.deps.sessions.playerFromRequest(req);
    if (!player) throw new HttpError(401, 'Create a player profile first');
    return player;
  }

  private parse<T>(schema: z.ZodType<T>, body: unknown): T {
    const result = schema.safeParse(body);
    if (!result.success) {
      const issue = result.error.issues[0];
      throw new HttpError(400, issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request');
    }
    return result.data;
  }

  private serverInfo() {
    return {
      name: 'Blockhaven',
      version: this.deps.version,
      lanUrls: getLanUrls(this.deps.config.PORT),
      playersOnline: this.deps.rooms.totalPlayers,
      worldsLoaded: this.deps.rooms.loadedRooms.length,
    };
  }

  private async getSession(req: IncomingMessage) {
    const player = await this.deps.sessions.playerFromRequest(req);
    return { player: player ? publicPlayer(player) : null };
  }

  private async createSession(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const body = this.parse(sessionSchema, await readJsonBody(req));
    const name = sanitizeDisplayName(body.displayName);
    if (!name) throw new HttpError(400, 'Names must be 2-16 characters: letters, numbers, spaces, _ . -');
    const appearance = parseAppearance({ ...DEFAULT_APPEARANCE, ...body.appearance });
    // Reuse the existing guest identity if the browser already has one.
    const existing = await this.deps.sessions.playerFromRequest(req);
    if (existing) {
      const updated = await this.deps.prisma.player.update({ where: { id: existing.id }, data: { displayName: name, appearance: { ...appearance }, lastSeenAt: new Date() } });
      sendJson(res, 200, { player: publicPlayer(updated) });
      return true;
    }
    const { player, token } = await this.deps.sessions.createGuest(name, appearance, req.headers['user-agent']);
    this.deps.log.info('Guest player created', { player: name });
    sendJson(res, 201, { player: publicPlayer(player) }, { 'Set-Cookie': this.deps.sessions.sessionCookie(token) });
    return true;
  }

  private async logout(req: IncomingMessage, res: ServerResponse): Promise<true> {
    await this.deps.sessions.revoke(this.deps.sessions.tokenFromRequest(req));
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': this.deps.sessions.clearCookie() });
    return true;
  }

  private async updateProfile(req: IncomingMessage) {
    const player = await this.requirePlayer(req);
    const body = this.parse(profileSchema, await readJsonBody(req));
    const data: { displayName?: string; appearance?: object } = {};
    if (body.displayName !== undefined) {
      const name = sanitizeDisplayName(body.displayName);
      if (!name) throw new HttpError(400, 'Names must be 2-16 characters: letters, numbers, spaces, _ . -');
      data.displayName = name;
    }
    if (body.appearance) data.appearance = { ...parseAppearance({ ...parseAppearance(player.appearance), ...body.appearance }) };
    const updated = await this.deps.prisma.player.update({ where: { id: player.id }, data });
    return { player: publicPlayer(updated) };
  }

  private async listWorlds(req: IncomingMessage) {
    const player = await this.requirePlayer(req);
    return { worlds: await this.deps.rooms.listWorlds(player.id) };
  }

  private async getWorld(req: IncomingMessage, id: string) {
    const player = await this.requirePlayer(req);
    const world = await this.deps.repo.getWorld(id);
    if (!world || (world.visibility === 'PRIVATE' && world.ownerId !== player.id)) throw new HttpError(404, 'World not found');
    return { world: this.deps.rooms.summarize(world, player.id) };
  }

  private async createWorld(req: IncomingMessage) {
    const player = await this.requirePlayer(req);
    let bucket = this.createLimiter.get(player.id);
    if (!bucket) {
      bucket = new TokenBucket(1 / 10, 5);
      this.createLimiter.set(player.id, bucket);
    }
    if (!bucket.tryTake()) throw new HttpError(429, 'You are creating worlds too quickly');
    const body = this.parse(createWorldSchema, await readJsonBody(req));
    const name = sanitizeWorldName(body.name);
    if (!name) throw new HttpError(400, 'World names must be 1-32 characters');
    if (body.password && body.password.length < 3) throw new HttpError(400, 'Passwords must be at least 3 characters');
    const seed = body.seed.trim() || String(randomInt(1, 2_147_483_647));
    const gameMode = body.gameMode.toUpperCase() as 'CREATIVE' | 'SURVIVAL' | 'SPECTATOR';
    const world = await this.deps.repo.createWorld(
      {
        name,
        seed,
        ownerId: player.id,
        gameMode,
        visibility: body.visibility.toUpperCase() as 'PUBLIC' | 'UNLISTED' | 'PRIVATE',
        maxPlayers: body.maxPlayers,
        passwordHash: body.password ? await hashPassword(body.password) : null,
        weather: 'clear',
        worldTime: 1000,
      },
      {
        terrainType: body.terrainType,
        dayNightCycle: body.dayNightCycle,
        weatherEnabled: body.weatherEnabled,
        buildPermission: body.buildPermission.toUpperCase() as 'EVERYONE' | 'MEMBERS' | 'OWNER',
        includeShowcase: body.includeShowcase,
      },
    );
    this.deps.log.info('World created', { world: name, owner: player.displayName, seed });
    this.deps.rooms.notifyLobby();
    const full = await this.deps.repo.getWorld(world.id);
    return { world: this.deps.rooms.summarize(full!, player.id) };
  }

  private async deleteWorld(req: IncomingMessage, id: string) {
    const player = await this.requirePlayer(req);
    const world = await this.deps.repo.getWorld(id);
    if (!world) throw new HttpError(404, 'World not found');
    if (world.ownerId !== player.id) throw new HttpError(403, 'Only the owner can delete this world');
    await this.deps.rooms.unloadWorld(id, 'This world was deleted by its owner.');
    await this.deps.repo.deleteWorld(id);
    this.deps.rooms.notifyLobby();
    return { ok: true };
  }
}

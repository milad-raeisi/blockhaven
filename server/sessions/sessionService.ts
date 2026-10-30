import { createHmac, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Player, PrismaClient } from '@prisma/client';
import type { Appearance } from '../../src/network/protocol/messages';
import { parseCookies } from '../http/json';
import { sanitizeColor } from '../security/sanitize';

export const SESSION_COOKIE = 'bh_session';
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export const DEFAULT_APPEARANCE: Appearance = { skin: '#d9a066', shirt: '#3b7dd8', pants: '#3a3a5c' };

export function parseAppearance(raw: unknown): Appearance {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    skin: sanitizeColor(a.skin, DEFAULT_APPEARANCE.skin),
    shirt: sanitizeColor(a.shirt, DEFAULT_APPEARANCE.shirt),
    pants: sanitizeColor(a.pants, DEFAULT_APPEARANCE.pants),
  };
}

/**
 * Guest identity: a random token in an HttpOnly cookie. Only an HMAC of the
 * token is stored, so a database leak does not expose usable sessions.
 */
export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly secret: string,
    private readonly secureCookies: boolean,
  ) {}

  private hashToken(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }

  async createGuest(displayName: string, appearance: Appearance, userAgent?: string): Promise<{ player: Player; token: string }> {
    const token = randomBytes(32).toString('hex');
    const player = await this.prisma.player.create({
      data: {
        displayName,
        appearance: { ...appearance },
        sessions: {
          create: {
            tokenHash: this.hashToken(token),
            expiresAt: new Date(Date.now() + SESSION_TTL_MS),
            userAgent: userAgent?.slice(0, 256),
          },
        },
      },
    });
    return { player, token };
  }

  /** Resolve the player for a raw session token, or null if invalid / expired. */
  async verifyToken(token: string | undefined): Promise<Player | null> {
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const session = await this.prisma.playerSession.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { player: true },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) return null;
    // Touch at most once per hour to avoid a write per request.
    if (Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
      await this.prisma.playerSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } });
    }
    return session.player;
  }

  async playerFromRequest(req: IncomingMessage): Promise<Player | null> {
    return this.verifyToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.prisma.playerSession.deleteMany({ where: { tokenHash: this.hashToken(token) } });
  }

  tokenFromRequest(req: IncomingMessage): string | undefined {
    return parseCookies(req.headers.cookie)[SESSION_COOKIE];
  }

  sessionCookie(token: string): string {
    const parts = [
      `${SESSION_COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (this.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookie(): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
}

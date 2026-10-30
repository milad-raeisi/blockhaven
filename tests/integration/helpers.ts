import 'dotenv/config';
import WebSocket from 'ws';
import { createGameServer, type GameServer } from '../../server/app';
import { loadConfig } from '../../server/lib/config';
import { setLogLevel } from '../../server/lib/logger';
import { emptyInput, type PlayerInput } from '../../src/game/physics/player';
import type { ClientMessage, ServerMessage, ServerMessageOf, ServerMessageType, WorldSummary } from '../../src/network/protocol/messages';
import { PROTOCOL_VERSION } from '../../src/network/protocol/messages';
import { TEST_DATABASE_URL } from './testDatabase';

export interface TestServer {
  game: GameServer;
  baseUrl: string;
  wsUrl: string;
  stop(): Promise<void>;
}

export async function startServer(overrides: Record<string, string> = {}): Promise<TestServer> {
  setLogLevel('warn');
  const config = loadConfig(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    HOST: '127.0.0.1',
    PORT: '0',
    SESSION_SECRET: 'integration-test-secret-value',
    LOG_LEVEL: 'warn',
    SAVE_INTERVAL_MS: '60000',
    ...overrides,
  });
  const game = createGameServer(config);
  const { port } = await game.listen();
  return {
    game,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    stop: () => game.stop(),
  };
}

export async function createPlayer(baseUrl: string, displayName: string, cookie?: string): Promise<{ cookie: string; id: string }> {
  const res = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ displayName }),
  });
  if (!res.ok) throw new Error(`createPlayer failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { player: { id: string } };
  const setCookie = res.headers.get('set-cookie');
  return { cookie: setCookie ? setCookie.split(';')[0] : (cookie ?? ''), id: body.player.id };
}

export async function createWorld(baseUrl: string, cookie: string, options: Record<string, unknown> = {}): Promise<WorldSummary> {
  const res = await fetch(`${baseUrl}/api/worlds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Creative World', seed: 'integration-seed', includeShowcase: false, weatherEnabled: false, ...options }),
  });
  if (!res.ok) throw new Error(`createWorld failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { world: WorldSummary }).world;
}

/** A real WebSocket client speaking the game protocol. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  private listeners: Array<() => void> = [];
  playerId = '';
  private inputSeq = 0;
  worldId = '';

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      for (const l of [...this.listeners]) l();
    });
  }

  static async connect(wsUrl: string, cookie: string): Promise<TestClient> {
    const ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`Upgrade rejected: ${res.statusCode}`)));
    });
    const client = new TestClient(ws);
    const welcome = client.waitFor('connection:welcome');
    client.send({ type: 'connection:hello', protocol: PROTOCOL_VERSION, client: 'integration-test' });
    client.playerId = (await welcome).playerId;
    return client;
  }

  send(message: ClientMessage): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(raw: string): void {
    this.ws.send(raw);
  }

  /** Wait for a future message (or a past one with includePast). */
  waitFor<T extends ServerMessageType>(
    type: T,
    predicate: (msg: ServerMessageOf<T>) => boolean = () => true,
    { timeout = 8000, includePast = false }: { timeout?: number; includePast?: boolean } = {},
  ): Promise<ServerMessageOf<T>> {
    let index = includePast ? 0 : this.messages.length;
    return new Promise((resolve, reject) => {
      const check = () => {
        for (; index < this.messages.length; index++) {
          const msg = this.messages[index];
          if (msg.type === type && predicate(msg as ServerMessageOf<T>)) {
            cleanup();
            resolve(msg as ServerMessageOf<T>);
            return;
          }
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeout);
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== check);
      };
      this.listeners.push(check);
      check();
    });
  }

  received<T extends ServerMessageType>(type: T, predicate: (msg: ServerMessageOf<T>) => boolean = () => true): ServerMessageOf<T>[] {
    return this.messages.filter((m) => m.type === type && predicate(m as ServerMessageOf<T>)) as ServerMessageOf<T>[];
  }

  async join(worldId: string, password?: string): Promise<ServerMessageOf<'world:metadata'>> {
    this.worldId = worldId;
    const meta = this.waitFor('world:metadata');
    this.send({ type: 'world:join', worldId, renderDistance: 2, ...(password ? { password } : {}) });
    return meta;
  }

  /** Subscribe to chunks so block updates for them are delivered. */
  async requestChunks(chunks: [number, number][]): Promise<void> {
    const pending = chunks.map(([cx, cz]) => this.waitFor('world:chunk-data', (m) => m.cx === cx && m.cz === cz));
    this.send({ type: 'world:chunk-request', worldId: this.worldId, chunks: chunks.map(([cx, cz]) => [cx, cz, -1] as [number, number, number]) });
    await Promise.all(pending);
  }

  sendInputs(count: number, patch: Partial<PlayerInput>): void {
    const inputs: PlayerInput[] = [];
    for (let i = 0; i < count; i++) inputs.push({ ...emptyInput(++this.inputSeq), ...patch, seq: this.inputSeq });
    for (let i = 0; i < inputs.length; i += 20) this.send({ type: 'player:input', worldId: this.worldId, inputs: inputs.slice(i, i + 20) });
  }

  async close(): Promise<void> {
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { encodeServerMessage } from '../../src/network/protocol/codec';
import type { Appearance, ServerMessage } from '../../src/network/protocol/messages';
import type { ServerPlayer } from '../players/ServerPlayer';
import type { WorldRoom } from '../rooms/WorldRoom';
import { ConnectionRateLimiter } from '../security/rateLimiter';

/** Close the socket if the client stops reading and the send buffer grows this large. */
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface AuthenticatedPlayer {
  id: string;
  displayName: string;
  appearance: Appearance;
}

/** One authenticated WebSocket connection. */
export class ClientConnection {
  readonly id = randomUUID();
  readonly limiter = new ConnectionRateLimiter();
  helloReceived = false;
  alive = true;
  lobbySubscribed = false;
  room: WorldRoom | null = null;
  player: ServerPlayer | null = null;
  /** Joins and leaves are processed strictly in order per connection. */
  worldQueue: Promise<void> = Promise.resolve();
  invalidMessages = 0;

  constructor(
    readonly ws: WebSocket,
    readonly account: AuthenticatedPlayer,
    readonly remoteAddress: string,
  ) {}

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  send(message: ServerMessage): void {
    if (!this.isOpen) return;
    if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.ws.terminate();
      return;
    }
    this.ws.send(encodeServerMessage(message));
  }

  close(code: number, reason: string): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close(code, reason.slice(0, 120));
    }
  }
}

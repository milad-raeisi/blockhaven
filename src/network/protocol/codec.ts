import { clientMessageSchema, MAX_CLIENT_MESSAGE_BYTES, type ClientMessage, type ServerMessage } from './messages';

export type DecodeResult = { ok: true; message: ClientMessage } | { ok: false; error: string };

/** Parse and validate an untrusted client message. */
export function decodeClientMessage(raw: string): DecodeResult {
  if (raw.length > MAX_CLIENT_MESSAGE_BYTES) return { ok: false, error: 'Message too large' };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Malformed JSON' };
  }
  const parsed = clientMessageSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid message' };
  }
  return { ok: true, message: parsed.data };
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function encodeClientMessage(message: ClientMessage): string {
  return JSON.stringify(message);
}

/** Parse a server message (trusted source; only structural checks). */
export function decodeServerMessage(raw: string): ServerMessage | null {
  try {
    const value = JSON.parse(raw) as { type?: unknown };
    if (!value || typeof value !== 'object' || typeof value.type !== 'string') return null;
    return value as ServerMessage;
  } catch {
    return null;
  }
}

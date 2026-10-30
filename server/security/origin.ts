import type { IncomingMessage } from 'node:http';

/**
 * Validate the Origin header of WebSocket upgrades and state-changing HTTP
 * requests. Browsers on the LAN reach the server through whatever host name or
 * IP they typed, so same-host origins are always accepted; anything else must
 * be listed in ALLOWED_ORIGINS.
 */
export function isOriginAllowed(req: IncomingMessage, allowedOrigins: readonly string[]): boolean {
  const origin = req.headers.origin;
  // Non-browser clients (tests, tools) do not send an Origin header.
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return typeof host === 'string' && originHost.toLowerCase() === host.toLowerCase();
}

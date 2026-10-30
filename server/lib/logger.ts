type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = ORDER[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? ORDER.info;

export function setLogLevel(level: Level): void {
  threshold = ORDER[level];
}

export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

function format(data?: Record<string, unknown>): string {
  if (!data) return '';
  const parts = Object.entries(data).map(([k, v]) => {
    if (v instanceof Error) return `${k}=${v.message}`;
    return `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`;
  });
  return parts.length ? ' ' + parts.join(' ') : '';
}

export function createLogger(scope: string): Logger {
  const write = (level: Level, message: string, data?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${format(data)}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    const err = data?.error;
    if (level === 'error' && err instanceof Error && err.stack && threshold <= ORDER.debug) console.error(err.stack);
  };
  return {
    debug: (m, d) => write('debug', m, d),
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

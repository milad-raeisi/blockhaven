import 'dotenv/config';
import { readFileSync } from 'node:fs';
import next from 'next';
import { createGameServer } from './app';
import { loadConfig } from './lib/config';
import { createLogger, setLogLevel } from './lib/logger';
import { getLanUrls } from './lib/network';

const log = createLogger('main');

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.LOG_LEVEL);
  const dev = config.NODE_ENV !== 'production';
  const version = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

  if (config.SESSION_SECRET === 'change-me-to-a-long-random-string') {
    log.warn('SESSION_SECRET is still the example value. Set a random secret in .env for real deployments.');
  }

  log.info(`Starting Blockhaven ${version} (${dev ? 'development' : 'production'})`);
  const app = next({ dev, hostname: 'localhost', port: config.PORT, webpack: true });
  await app.prepare();

  const game = createGameServer(config, { request: app.getRequestHandler(), upgrade: app.getUpgradeHandler() }, version);
  const { port } = await game.listen();

  const lines = [
    '',
    '  Blockhaven is running!',
    '',
    `  On this computer:   http://localhost:${port}`,
    ...getLanUrls(port).map((url) => `  On your network:    ${url}`),
    '',
    '  Share a network address with players on the same Wi-Fi or Ethernet.',
    '  Press Ctrl+C to stop the server (worlds are saved automatically).',
    '',
  ];
  console.log(lines.join('\n'));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}`);
    const force = setTimeout(() => {
      log.error('Shutdown timed out; exiting');
      process.exit(1);
    }, 15_000);
    try {
      await game.stop('The server is shutting down. Your progress has been saved.');
      await app.close().catch(() => undefined);
    } finally {
      clearTimeout(force);
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => log.error('Unhandled promise rejection', { error: reason as Error }));
}

main().catch((error: unknown) => {
  log.error('Failed to start server', { error: error as Error });
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

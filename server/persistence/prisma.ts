import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

/** Shared Prisma client. The URL can be overridden (integration tests use a separate database). */
export function getPrisma(databaseUrl?: string): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
      log: ['warn', 'error'],
    });
  }
  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    const c = client;
    client = null;
    await c.$disconnect();
  }
}

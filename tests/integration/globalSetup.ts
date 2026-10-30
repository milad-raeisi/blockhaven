import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { TEST_DATABASE_URL } from './testDatabase';

/** Prepare the dedicated integration-test database: apply migrations and wipe data. */
export default async function setup(): Promise<void> {
  execSync('pnpm prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "ContainerInventory", "PlayerInventory", "PlayerWorldState", "WorldChunk", "WorldMembership", "WorldSettings", "World", "PlayerSession", "Player" CASCADE',
    );
  } finally {
    await prisma.$disconnect();
  }
}

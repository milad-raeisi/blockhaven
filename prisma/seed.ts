import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Optional demo data: a public "Showcase World" owned by a "Server" player,
 * so a fresh installation has a world to join right away. Safe to run again.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    let owner = await prisma.player.findFirst({ where: { displayName: 'Server', sessions: { none: {} } } });
    if (!owner) {
      owner = await prisma.player.create({
        data: { displayName: 'Server', appearance: { skin: '#d9a066', shirt: '#6aad3f', pants: '#3a3a5c' } },
      });
    }
    const existing = await prisma.world.findFirst({ where: { ownerId: owner.id, name: 'Showcase World' } });
    if (existing) {
      console.log(`Showcase World already exists (code ${existing.id}).`);
      return;
    }
    const world = await prisma.world.create({
      data: {
        name: 'Showcase World',
        seed: 'blockhaven',
        ownerId: owner.id,
        gameMode: 'CREATIVE',
        visibility: 'PUBLIC',
        maxPlayers: 8,
        settings: { create: { terrainType: 'default', includeShowcase: true, buildPermission: 'EVERYONE' } },
      },
    });
    console.log(`Created Showcase World (code ${world.id}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

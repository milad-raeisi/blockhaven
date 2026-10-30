-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('CREATIVE', 'SURVIVAL', 'SPECTATOR');

-- CreateEnum
CREATE TYPE "WorldVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "BuildPermission" AS ENUM ('EVERYONE', 'MEMBERS', 'OWNER');

-- CreateEnum
CREATE TYPE "WorldRole" AS ENUM ('OWNER', 'BUILDER', 'VISITOR');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "displayName" VARCHAR(16) NOT NULL,
    "appearance" JSONB NOT NULL,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSession" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "userAgent" VARCHAR(256),

    CONSTRAINT "PlayerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "World" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "ownerId" TEXT NOT NULL,
    "seed" VARCHAR(64) NOT NULL,
    "gameMode" "GameMode" NOT NULL DEFAULT 'CREATIVE',
    "visibility" "WorldVisibility" NOT NULL DEFAULT 'PUBLIC',
    "maxPlayers" INTEGER NOT NULL DEFAULT 8,
    "passwordHash" TEXT,
    "worldTime" INTEGER NOT NULL DEFAULT 1000,
    "weather" VARCHAR(16) NOT NULL DEFAULT 'clear',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastPlayedAt" TIMESTAMP(3),

    CONSTRAINT "World_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldSettings" (
    "worldId" TEXT NOT NULL,
    "terrainType" VARCHAR(16) NOT NULL DEFAULT 'default',
    "dayNightCycle" BOOLEAN NOT NULL DEFAULT true,
    "weatherEnabled" BOOLEAN NOT NULL DEFAULT true,
    "buildPermission" "BuildPermission" NOT NULL DEFAULT 'EVERYONE',
    "includeShowcase" BOOLEAN NOT NULL DEFAULT true,
    "showcaseBuilt" BOOLEAN NOT NULL DEFAULT false,
    "spawnX" INTEGER,
    "spawnY" INTEGER,
    "spawnZ" INTEGER,

    CONSTRAINT "WorldSettings_pkey" PRIMARY KEY ("worldId")
);

-- CreateTable
CREATE TABLE "WorldMembership" (
    "id" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "role" "WorldRole" NOT NULL DEFAULT 'VISITOR',
    "canBuild" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldChunk" (
    "worldId" TEXT NOT NULL,
    "cx" INTEGER NOT NULL,
    "cz" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldChunk_pkey" PRIMARY KEY ("worldId","cx","cz")
);

-- CreateTable
CREATE TABLE "PlayerWorldState" (
    "playerId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "z" DOUBLE PRECISION NOT NULL,
    "yaw" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pitch" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gameMode" "GameMode" NOT NULL,
    "flying" BOOLEAN NOT NULL DEFAULT false,
    "selectedSlot" INTEGER NOT NULL DEFAULT 0,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerWorldState_pkey" PRIMARY KEY ("playerId","worldId")
);

-- CreateTable
CREATE TABLE "PlayerInventory" (
    "playerId" TEXT NOT NULL,
    "worldId" TEXT NOT NULL,
    "slots" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerInventory_pkey" PRIMARY KEY ("playerId","worldId")
);

-- CreateTable
CREATE TABLE "ContainerInventory" (
    "worldId" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "z" INTEGER NOT NULL,
    "slots" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContainerInventory_pkey" PRIMARY KEY ("worldId","x","y","z")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSession_tokenHash_key" ON "PlayerSession"("tokenHash");

-- CreateIndex
CREATE INDEX "PlayerSession_playerId_idx" ON "PlayerSession"("playerId");

-- CreateIndex
CREATE INDEX "PlayerSession_expiresAt_idx" ON "PlayerSession"("expiresAt");

-- CreateIndex
CREATE INDEX "World_ownerId_idx" ON "World"("ownerId");

-- CreateIndex
CREATE INDEX "World_visibility_idx" ON "World"("visibility");

-- CreateIndex
CREATE INDEX "WorldMembership_playerId_idx" ON "WorldMembership"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorldMembership_worldId_playerId_key" ON "WorldMembership"("worldId", "playerId");

-- CreateIndex
CREATE INDEX "PlayerWorldState_worldId_idx" ON "PlayerWorldState"("worldId");

-- AddForeignKey
ALTER TABLE "PlayerSession" ADD CONSTRAINT "PlayerSession_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "World" ADD CONSTRAINT "World_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldSettings" ADD CONSTRAINT "WorldSettings_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldMembership" ADD CONSTRAINT "WorldMembership_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldMembership" ADD CONSTRAINT "WorldMembership_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldChunk" ADD CONSTRAINT "WorldChunk_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerWorldState" ADD CONSTRAINT "PlayerWorldState_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerWorldState" ADD CONSTRAINT "PlayerWorldState_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInventory" ADD CONSTRAINT "PlayerInventory_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInventory" ADD CONSTRAINT "PlayerInventory_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContainerInventory" ADD CONSTRAINT "ContainerInventory_worldId_fkey" FOREIGN KEY ("worldId") REFERENCES "World"("id") ON DELETE CASCADE ON UPDATE CASCADE;

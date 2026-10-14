-- SpotiStats PostgreSQL bootstrap for a new, empty hosted database.
-- The database itself must be created by the hosting provider first.
-- This script also baselines the initial Prisma migration so `prisma migrate deploy` is safe.
BEGIN;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ListeningSource" AS ENUM ('SPOTIFY_API', 'IMPORT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncType" AS ENUM ('RECENTLY_PLAYED', 'TOP_TRACKS', 'TOP_ARTISTS');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SnapshotType" AS ENUM ('TRACK', 'ARTIST');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "spotifyUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "email" TEXT,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpotifyConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "refreshTokenEncrypted" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "grantedScopes" TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotifyConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListeningEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackSpotifyId" TEXT,
    "trackUri" TEXT,
    "trackName" TEXT NOT NULL,
    "artistName" TEXT NOT NULL,
    "albumName" TEXT,
    "playedAt" TIMESTAMP(3) NOT NULL,
    "msPlayed" INTEGER,
    "source" "ListeningSource" NOT NULL,
    "importId" TEXT,
    "dedupeKey" TEXT,
    "skipped" BOOLEAN,
    "shuffle" BOOLEAN,
    "rawMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListeningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HistoryImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "filename" TEXT NOT NULL,
    "fileChecksum" TEXT NOT NULL,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "importedRecords" INTEGER NOT NULL DEFAULT 0,
    "skippedRecords" INTEGER NOT NULL DEFAULT 0,
    "failedRecords" INTEGER NOT NULL DEFAULT 0,
    "earliestPlayedAt" TIMESTAMP(3),
    "latestPlayedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorSummary" TEXT,

    CONSTRAINT "HistoryImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "syncType" "SyncType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastCursor" TEXT,
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopItemSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemType" "SnapshotType" NOT NULL,
    "spotifyItemId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "TopItemSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_spotifyUserId_key" ON "User"("spotifyUserId");

-- CreateIndex
CREATE INDEX "AppSession_userId_expiresAt_idx" ON "AppSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SpotifyConnection_userId_key" ON "SpotifyConnection"("userId");

-- CreateIndex
CREATE INDEX "ListeningEvent_userId_playedAt_idx" ON "ListeningEvent"("userId", "playedAt");

-- CreateIndex
CREATE INDEX "ListeningEvent_userId_trackSpotifyId_idx" ON "ListeningEvent"("userId", "trackSpotifyId");

-- CreateIndex
CREATE INDEX "ListeningEvent_importId_idx" ON "ListeningEvent"("importId");

-- CreateIndex
CREATE INDEX "ListeningEvent_userId_source_playedAt_idx" ON "ListeningEvent"("userId", "source", "playedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListeningEvent_userId_dedupeKey_key" ON "ListeningEvent"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "HistoryImport_userId_startedAt_idx" ON "HistoryImport"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "HistoryImport_userId_status_idx" ON "HistoryImport"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "HistoryImport_userId_fileChecksum_key" ON "HistoryImport"("userId", "fileChecksum");

-- CreateIndex
CREATE INDEX "SyncRun_userId_startedAt_idx" ON "SyncRun"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "SyncRun_userId_status_idx" ON "SyncRun"("userId", "status");

-- CreateIndex
CREATE INDEX "TopItemSnapshot_userId_itemType_period_snapshotAt_idx" ON "TopItemSnapshot"("userId", "itemType", "period", "snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "TopItemSnapshot_userId_itemType_spotifyItemId_period_snapsh_key" ON "TopItemSnapshot"("userId", "itemType", "spotifyItemId", "period", "snapshotAt");

-- AddForeignKey
ALTER TABLE "AppSession" ADD CONSTRAINT "AppSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpotifyConnection" ADD CONSTRAINT "SpotifyConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListeningEvent" ADD CONSTRAINT "ListeningEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListeningEvent" ADD CONSTRAINT "ListeningEvent_importId_fkey" FOREIGN KEY ("importId") REFERENCES "HistoryImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryImport" ADD CONSTRAINT "HistoryImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncRun" ADD CONSTRAINT "SyncRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopItemSnapshot" ADD CONSTRAINT "TopItemSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Record the equivalent Prisma migration as already applied.
CREATE TABLE "_prisma_migrations" (
    "id" VARCHAR(36) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "_prisma_migrations"
    ("id", "checksum", "finished_at", "migration_name", "started_at", "applied_steps_count")
VALUES
    ('4dfc09a4-8c55-4d9d-a6ae-9a7a0b5eb201', 'a983e244c1177b8d1225e8cc16172e6d1d0f07d5bb42994ad1773d5394a64dc1', now(), '20261014000000_init', now(), 1);

COMMIT;
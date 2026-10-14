import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { requireSession } from "../auth/session.js";

export async function privacyRoutes(app: FastifyInstance): Promise<void> {
  app.get("/privacy/export", { preHandler: [requireSession], schema: { tags: ["privacy"], summary: "Download account data as JSON Lines" } }, async (request, reply) => {
    const userId = request.userId!;
    const user = await prisma.user.findFirst({ where: { id: userId }, select: { id: true, spotifyUserId: true, displayName: true, email: true, country: true, createdAt: true, updatedAt: true } });
    if (!user) return reply.code(404).send({ error: { code: "ACCOUNT_NOT_FOUND", message: "Account not found." } });
    const stream = Readable.from((async function* () {
      yield `${JSON.stringify({ type: "user", data: user })}\n`;
      const imports = await prisma.historyImport.findMany({ where: { userId }, orderBy: { startedAt: "asc" } });
      for (const item of imports) yield `${JSON.stringify({ type: "history_import", data: item })}\n`;
      let cursor: string | undefined;
      while (true) {
        const events = await prisma.listeningEvent.findMany({ where: { userId }, orderBy: { id: "asc" }, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, trackSpotifyId: true, trackUri: true, trackName: true, artistName: true, albumName: true, playedAt: true, msPlayed: true, source: true, importId: true, skipped: true, shuffle: true, createdAt: true } });
        if (!events.length) break;
        for (const event of events) yield `${JSON.stringify({ type: "listening_event", data: event })}\n`;
        cursor = events.at(-1)?.id;
        if (events.length < 1000) break;
      }
      const syncRuns = await prisma.syncRun.findMany({ where: { userId }, orderBy: { startedAt: "asc" }, select: { id: true, syncType: true, status: true, startedAt: true, completedAt: true, recordsProcessed: true, errorSummary: true } });
      for (const run of syncRuns) yield `${JSON.stringify({ type: "sync_run", data: run })}\n`;
      const snapshots = await prisma.topItemSnapshot.findMany({ where: { userId }, orderBy: { snapshotAt: "asc" }, select: { itemType: true, spotifyItemId: true, period: true, rank: true, snapshotAt: true, metadata: true } });
      for (const snapshot of snapshots) yield `${JSON.stringify({ type: "spotify_affinity_snapshot", data: snapshot })}\n`;
    })());
    return reply.header("Content-Disposition", 'attachment; filename="spotistats-export.jsonl"').type("application/x-ndjson; charset=utf-8").send(stream);
  });
}

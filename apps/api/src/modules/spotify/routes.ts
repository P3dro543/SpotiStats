import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireSession } from "../auth/session.js";
import { stablePlayKey } from "../history/normalize.js";
import { SpotifyError, spotifyRequest } from "./client.js";

const topQuery = z.object({ type: z.enum(["artists", "tracks"]), time_range: z.enum(["short_term", "medium_term", "long_term"]).default("medium_term") });
const syncInFlight = new Set<string>();

type SpotifyArtist = { id: string; name: string; uri?: string };
type SpotifyTrack = { id: string; name: string; uri: string; artists: SpotifyArtist[]; album?: { name: string; images?: Array<{ url: string }> }; duration_ms?: number };
type RecentResponse = { items: Array<{ played_at: string; track: SpotifyTrack }>; cursors?: { after?: string }; next?: string | null };
type TopResponse = { items: Array<Record<string, unknown> & { id: string; name: string; uri: string; artists?: SpotifyArtist[]; album?: { name: string; images?: Array<{ url: string }> } }> };

export async function spotifyRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Record<string, string | undefined> }>("/spotify/top-items", { preHandler: [requireSession], schema: { tags: ["spotify"], summary: "Get Spotify affinity top artists or tracks" } }, async (request, reply) => {
    const query = topQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Choose artists or tracks and a supported time range." } });
    const { type, time_range } = query.data;
    const latest = await prisma.topItemSnapshot.findFirst({ where: { userId: request.userId!, itemType: type === "artists" ? "ARTIST" : "TRACK", period: time_range }, orderBy: { snapshotAt: "desc" }, select: { snapshotAt: true } });
    if (latest && Date.now() - latest.snapshotAt.getTime() < 6 * 60 * 60 * 1000) {
      const items = await prisma.topItemSnapshot.findMany({ where: { userId: request.userId!, itemType: type === "artists" ? "ARTIST" : "TRACK", period: time_range, snapshotAt: latest.snapshotAt }, orderBy: { rank: "asc" } });
      return { data: { items: items.map((item) => item.metadata), period: time_range, source: "spotify_affinity", snapshotAt: latest.snapshotAt, cached: true } };
    }
    try {
      const response = await spotifyRequest<TopResponse>(request.userId!, `/me/top/${type}?time_range=${time_range}&limit=50`);
      const snapshotAt = new Date();
      const items = response.items.map((item, index) => {
        const metadata = type === "artists"
          ? { id: item.id, name: item.name, uri: item.uri, rank: index + 1 }
          : { id: item.id, name: item.name, uri: item.uri, artists: item.artists?.map((artist) => ({ id: artist.id, name: artist.name })) ?? [], album: item.album?.name ?? null, imageUrl: item.album?.images?.[0]?.url ?? null, rank: index + 1 };
        return { userId: request.userId!, itemType: type === "artists" ? "ARTIST" as const : "TRACK" as const, spotifyItemId: item.id, period: time_range, rank: index + 1, snapshotAt, metadata };
      });
      if (items.length) await prisma.topItemSnapshot.createMany({ data: items });
      return { data: { items: items.map((item) => item.metadata), period: time_range, source: "spotify_affinity", snapshotAt, cached: false } };
    } catch (error) {
      throw error;
    }
  });

  app.post<{ Querystring: { after?: string } }>("/spotify/sync", { preHandler: [requireSession], schema: { tags: ["spotify"], summary: "Sync the latest recently played Spotify tracks" } }, async (request, reply) => {
    const after = request.query.after;
    if (after !== undefined && !/^\d{1,16}$/.test(after)) return reply.code(400).send({ error: { code: "INVALID_CURSOR", message: "The sync cursor must be a Unix timestamp in milliseconds." } });
    const userId = request.userId!;
    if (syncInFlight.has(userId)) return reply.code(409).send({ error: { code: "SYNC_IN_PROGRESS", message: "A Spotify sync is already running." } });
    syncInFlight.add(userId);
    const run = await prisma.syncRun.create({ data: { userId, syncType: "RECENTLY_PLAYED", status: "RUNNING", ...(after ? { lastCursor: after } : {}) } });
    try {
      const cursor = after ? `&after=${after}` : "";
      const result = await spotifyRequest<RecentResponse>(userId, `/me/player/recently-played?limit=50${cursor}`);
      const events = result.items.flatMap((entry) => {
        const track = entry.track;
        const playedAt = new Date(entry.played_at);
        const artistName = track.artists?.map((artist) => artist.name).join(", ") ?? "";
        if (!Number.isFinite(playedAt.getTime()) || !track.name || !artistName) return [];
        const uri = track.uri ?? null;
        return [{ userId, trackSpotifyId: track.id || null, trackUri: uri, trackName: track.name, artistName, albumName: track.album?.name ?? null, playedAt, msPlayed: null, source: "SPOTIFY_API" as const, dedupeKey: stablePlayKey(playedAt, uri, track.name, artistName) }];
      });
      const created = events.length ? await prisma.listeningEvent.createMany({ data: events, skipDuplicates: true }) : { count: 0 };
      await prisma.syncRun.update({ where: { id: run.id }, data: { status: "COMPLETED", completedAt: new Date(), recordsProcessed: created.count, lastCursor: result.cursors?.after ?? null } });
      return { data: { syncId: run.id, status: "COMPLETED", recordsFetched: events.length, recordsStored: created.count, cursor: result.cursors?.after ?? null, limitation: "Spotify recent-played is a limited recent window. It is not a complete listening history." } };
    } catch (error) {
      const safeMessage = error instanceof SpotifyError ? error.message : "Spotify synchronization failed.";
      await prisma.syncRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), errorSummary: safeMessage } });
      throw error;
    } finally {
      syncInFlight.delete(userId);
    }
  });

  app.get("/spotify/sync/status", { preHandler: [requireSession], schema: { tags: ["spotify"], summary: "Get Spotify sync status" } }, async (request) => {
    const runs = await prisma.syncRun.findMany({ where: { userId: request.userId! }, orderBy: { startedAt: "desc" }, take: 20, select: { id: true, syncType: true, status: true, startedAt: true, completedAt: true, recordsProcessed: true, errorSummary: true } });
    return { data: runs };
  });
}

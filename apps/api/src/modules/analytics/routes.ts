import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireSession } from "../auth/session.js";

const isoDate = z.string().datetime({ offset: true });
const filtersSchema = z.object({ from: isoDate.optional(), to: isoDate.optional(), source: z.enum(["ALL", "IMPORT", "SPOTIFY_API"]).default("ALL"), timezone: z.string().default("UTC") });
const topSchema = filtersSchema.extend({ limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).max(10000).default(0) });
type Filters = z.infer<typeof filtersSchema>;

function validateTimezone(value: string): string {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return value; }
  catch { throw new Error("Invalid timezone"); }
}

function eventWhere(userId: string, filters: Filters) {
  return Prisma.sql`WHERE "userId" = ${userId}
    ${filters.source === "ALL" ? Prisma.empty : Prisma.sql`AND "source" = ${filters.source}::"ListeningSource"`}
    ${filters.from ? Prisma.sql`AND "playedAt" >= ${new Date(filters.from)}` : Prisma.empty}
    ${filters.to ? Prisma.sql`AND "playedAt" < ${new Date(filters.to)}` : Prisma.empty}`;
}

async function summaryFor(userId: string, filters: Filters) {
  const where = eventWhere(userId, filters);
  const [row] = await prisma.$queryRaw<Array<{ events: bigint; milliseconds: bigint | null; durationEvents: bigint; uniqueTracks: bigint; uniqueArtists: bigint; uniqueAlbums: bigint; skipped: bigint; knownSkipEvents: bigint; firstPlay: Date | null }>>(Prisma.sql`
    SELECT count(*)::bigint AS events,
      coalesce(sum("msPlayed"), 0)::bigint AS milliseconds,
      count(*) FILTER (WHERE "msPlayed" IS NOT NULL)::bigint AS "durationEvents",
      count(DISTINCT coalesce("trackSpotifyId", "trackUri", "trackName" || E'\\x1f' || "artistName"))::bigint AS "uniqueTracks",
      count(DISTINCT "artistName")::bigint AS "uniqueArtists",
      count(DISTINCT CASE WHEN "albumName" IS NOT NULL AND "albumName" <> '' THEN "albumName" || E'\\x1f' || "artistName" END)::bigint AS "uniqueAlbums",
      count(*) FILTER (WHERE "skipped" IS TRUE)::bigint AS skipped,
      count(*) FILTER (WHERE "skipped" IS NOT NULL)::bigint AS "knownSkipEvents",
      min("playedAt") AS "firstPlay"
    FROM "ListeningEvent" ${where}`);
  const eventCount = Number(row?.events ?? 0n);
  const skipDenominator = Number(row?.knownSkipEvents ?? 0n);
  const firstPlay = row?.firstPlay ?? null;
  const rangeStart = filters.from ? new Date(filters.from) : firstPlay;
  const rangeEnd = filters.to ? new Date(filters.to) : new Date();
  const dayCount = rangeStart ? Math.max(1, Math.ceil((Math.min(Date.now(), rangeEnd.getTime()) - rangeStart.getTime()) / 86_400_000)) : 0;
  return {
    events: eventCount,
    listeningMilliseconds: Number(row?.milliseconds ?? 0n),
    durationCoverage: eventCount ? Number(row?.durationEvents ?? 0n) / eventCount : null,
    uniqueTracks: Number(row?.uniqueTracks ?? 0n),
    uniqueArtists: Number(row?.uniqueArtists ?? 0n),
    uniqueAlbums: Number(row?.uniqueAlbums ?? 0n),
    averageEventsPerDay: dayCount ? Number((eventCount / dayCount).toFixed(2)) : 0,
    skippedRate: skipDenominator ? Number((Number(row?.skipped ?? 0n) / skipDenominator).toFixed(4)) : null,
    skippedRateCoverage: skipDenominator ? "partial" : "unavailable",
    firstPlay,
  };
}

function validatedQuery(raw: unknown) {
  const result = filtersSchema.safeParse(raw);
  if (!result.success) return null;
  try { return { ...result.data, timezone: validateTimezone(result.data.timezone) }; }
  catch { return null; }
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: Record<string, string | undefined> }>("/dashboard/summary", { preHandler: [requireSession], schema: { tags: ["dashboard"], summary: "Aggregate listening statistics" } }, async (request, reply) => {
    const filters = validatedQuery(request.query);
    if (!filters) return reply.code(400).send({ error: { code: "INVALID_FILTERS", message: "Check date filters and timezone." } });
    const [summary, coverage] = await Promise.all([
      summaryFor(request.userId!, filters),
      prisma.historyImport.aggregate({ where: { userId: request.userId! }, _min: { earliestPlayedAt: true }, _max: { latestPlayedAt: true, completedAt: true }, _count: { id: true, _all: true }, _sum: { totalRecords: true, importedRecords: true, skippedRecords: true, failedRecords: true } }),
    ]);
    return { data: { ...summary, coverage: { earliest: coverage._min.earliestPlayedAt, latest: coverage._max.latestPlayedAt, lastImportedAt: coverage._max.completedAt, imports: coverage._count.id, totalRecords: coverage._sum.totalRecords ?? 0, importedRecords: coverage._sum.importedRecords ?? 0, skippedRecords: coverage._sum.skippedRecords ?? 0, failedRecords: coverage._sum.failedRecords ?? 0, isComplete: false, completenessNote: "Spotify export file coverage cannot be inferred automatically; use the export's file list to confirm all periods were uploaded." }, timezone: filters.timezone, source: filters.source } };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/dashboard/timeseries", { preHandler: [requireSession], schema: { tags: ["dashboard"], summary: "Listening time and event counts by local calendar date" } }, async (request, reply) => {
    const filters = validatedQuery(request.query);
    if (!filters) return reply.code(400).send({ error: { code: "INVALID_FILTERS", message: "Check date filters and timezone." } });
    const where = eventWhere(request.userId!, filters);
    const data = await prisma.$queryRaw<Array<{ date: string; events: bigint; milliseconds: bigint }>>(Prisma.sql`
      SELECT to_char(date_trunc('day', "playedAt" AT TIME ZONE ${filters.timezone}), 'YYYY-MM-DD') AS date,
        count(*)::bigint AS events, coalesce(sum("msPlayed"), 0)::bigint AS milliseconds
      FROM "ListeningEvent" ${where}
      GROUP BY date_trunc('day', "playedAt" AT TIME ZONE ${filters.timezone}) ORDER BY 1 ASC`);
    return { data: data.map((row) => ({ date: row.date, events: Number(row.events), minutes: Number(row.milliseconds) / 60_000 })) };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/dashboard/activity-heatmap", { preHandler: [requireSession], schema: { tags: ["dashboard"], summary: "Activity grouped by local weekday and hour" } }, async (request, reply) => {
    const filters = validatedQuery(request.query);
    if (!filters) return reply.code(400).send({ error: { code: "INVALID_FILTERS", message: "Check date filters and timezone." } });
    const where = eventWhere(request.userId!, filters);
    const data = await prisma.$queryRaw<Array<{ weekday: number; hour: number; events: bigint }>>(Prisma.sql`
      SELECT extract(dow FROM ("playedAt" AT TIME ZONE ${filters.timezone}))::int AS weekday,
        extract(hour FROM ("playedAt" AT TIME ZONE ${filters.timezone}))::int AS hour, count(*)::bigint AS events
      FROM "ListeningEvent" ${where} GROUP BY weekday, hour ORDER BY weekday, hour`);
    return { data: data.map((row) => ({ weekday: row.weekday, hour: row.hour, events: Number(row.events) })) };
  });

  for (const [route, dimension, select, group] of [
    ["/analytics/top-tracks", "tracks", Prisma.sql`coalesce("trackSpotifyId", "trackUri", "trackName" || E'\\x1f' || "artistName") AS key, "trackName" AS name, "artistName" AS artist, "albumName" AS album`, Prisma.sql`"trackSpotifyId", "trackUri", "trackName", "artistName", "albumName"`],
    ["/analytics/top-artists", "artists", Prisma.sql`"artistName" AS key, "artistName" AS name`, Prisma.sql`"artistName"`],
    ["/analytics/top-albums", "albums", Prisma.sql`("albumName" || E'\\x1f' || "artistName") AS key, "albumName" AS name, "artistName" AS artist`, Prisma.sql`"albumName", "artistName"`],
  ] as const) {
    app.get<{ Querystring: Record<string, string | undefined> }>(route, { preHandler: [requireSession], schema: { tags: ["analytics"], summary: `Rank ${dimension} by listening events and time` } }, async (request, reply) => {
      const parsed = topSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: { code: "INVALID_FILTERS", message: "Invalid ranking filters." } });
      let filters: Filters;
      try { filters = { ...parsed.data, timezone: validateTimezone(parsed.data.timezone) }; }
      catch { return reply.code(400).send({ error: { code: "INVALID_TIMEZONE", message: "Invalid timezone." } }); }
      const where = eventWhere(request.userId!, filters);
      const rows = await prisma.$queryRaw<Array<Record<string, unknown> & { key: string; name: string | null; events: bigint; milliseconds: bigint; skipped: bigint }>>(Prisma.sql`
        SELECT ${select}, count(*)::bigint AS events, coalesce(sum("msPlayed"), 0)::bigint AS milliseconds,
          count(*) FILTER (WHERE "skipped" IS TRUE)::bigint AS skipped
        FROM "ListeningEvent" ${where}
        ${dimension === "albums" ? Prisma.sql`AND "albumName" IS NOT NULL AND "albumName" <> ''` : Prisma.empty}
        GROUP BY ${group} ORDER BY events DESC, milliseconds DESC, name ASC
        LIMIT ${parsed.data.limit} OFFSET ${parsed.data.offset}`);
      return { data: rows.map((row, index) => ({ ...row, rank: parsed.data.offset + index + 1, events: Number(row.events), minutes: Number(row.milliseconds) / 60_000, skippedEvents: Number(row.skipped), milliseconds: undefined, skipped: undefined })), page: { limit: parsed.data.limit, offset: parsed.data.offset } };
    });
  }

  app.get<{ Querystring: Record<string, string | undefined> }>("/analytics/period-comparison", { preHandler: [requireSession], schema: { tags: ["analytics"], summary: "Compare listening totals between date ranges" } }, async (request, reply) => {
    const parsed = z.object({ from: isoDate, to: isoDate, source: z.enum(["ALL", "IMPORT", "SPOTIFY_API"]).default("ALL") }).safeParse(request.query);
    if (!parsed.success || new Date(parsed.data.to) <= new Date(parsed.data.from)) return reply.code(400).send({ error: { code: "INVALID_PERIOD", message: "Provide a valid start and end date." } });
    const { from, to, source } = parsed.data;
    const span = new Date(to).getTime() - new Date(from).getTime();
    const previousFrom = new Date(new Date(from).getTime() - span).toISOString();
    const conditions = (start: string, end: string) => Prisma.sql`WHERE "userId" = ${request.userId!} AND "playedAt" >= ${new Date(start)} AND "playedAt" < ${new Date(end)} ${source === "ALL" ? Prisma.empty : Prisma.sql`AND "source" = ${source}::"ListeningSource"`}`;
    const aggregate = async (start: string, end: string) => {
      const [row] = await prisma.$queryRaw<Array<{ events: bigint; milliseconds: bigint; artists: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS events, coalesce(sum("msPlayed"),0)::bigint AS milliseconds, count(DISTINCT "artistName")::bigint AS artists FROM "ListeningEvent" ${conditions(start, end)}`);
      return { events: Number(row?.events ?? 0n), minutes: Number(row?.milliseconds ?? 0n) / 60_000, artists: Number(row?.artists ?? 0n) };
    };
    const [current, previous] = await Promise.all([aggregate(from, to), aggregate(previousFrom, from)]);
    const percentChange = (now: number, before: number) => before === 0 ? null : Number(((now - before) / before * 100).toFixed(1));
    const sourceFilter = source === "ALL" ? Prisma.empty : Prisma.sql`AND "source" = ${source}::"ListeningSource"`;
    const [newArtistRows, returningRows] = await Promise.all([
      prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`SELECT DISTINCT now."artistName" AS name FROM "ListeningEvent" now WHERE now."userId"=${request.userId!} AND now."playedAt">=${new Date(from)} AND now."playedAt"<${new Date(to)} ${sourceFilter} AND NOT EXISTS (SELECT 1 FROM "ListeningEvent" prev WHERE prev."userId"=now."userId" AND prev."artistName"=now."artistName" AND prev."playedAt">=${new Date(previousFrom)} AND prev."playedAt"<${new Date(from)} ${sourceFilter}) ORDER BY name LIMIT 20`),
      prisma.$queryRaw<Array<{ name: string; artist: string; events: bigint }>>(Prisma.sql`WITH current_tracks AS (SELECT "trackName", "artistName", count(*)::bigint AS events FROM "ListeningEvent" WHERE "userId"=${request.userId!} AND "playedAt">=${new Date(from)} AND "playedAt"<${new Date(to)} ${sourceFilter} GROUP BY "trackName", "artistName"), previous_tracks AS (SELECT DISTINCT "trackName", "artistName" FROM "ListeningEvent" WHERE "userId"=${request.userId!} AND "playedAt">=${new Date(previousFrom)} AND "playedAt"<${new Date(from)} ${sourceFilter}), older_tracks AS (SELECT DISTINCT "trackName", "artistName" FROM "ListeningEvent" WHERE "userId"=${request.userId!} AND "playedAt"<${new Date(previousFrom)} ${sourceFilter}) SELECT current_tracks."trackName" AS name, current_tracks."artistName" AS artist, current_tracks.events FROM current_tracks WHERE NOT EXISTS (SELECT 1 FROM previous_tracks WHERE previous_tracks."trackName"=current_tracks."trackName" AND previous_tracks."artistName"=current_tracks."artistName") AND EXISTS (SELECT 1 FROM older_tracks WHERE older_tracks."trackName"=current_tracks."trackName" AND older_tracks."artistName"=current_tracks."artistName") ORDER BY current_tracks.events DESC LIMIT 20`),
    ]);
    return { data: { current: { from, to, ...current }, previous: { from: previousFrom, to: from, ...previous }, change: { eventsPercent: percentChange(current.events, previous.events), minutesPercent: percentChange(current.minutes, previous.minutes), artistsPercent: percentChange(current.artists, previous.artists) }, newArtists: newArtistRows.map((row) => row.name), returningTracks: returningRows.map((row) => ({ ...row, events: Number(row.events) })) } };
  });
}

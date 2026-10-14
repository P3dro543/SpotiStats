import { createHash } from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireSession } from "../auth/session.js";
import { normalizeExportRecord, type NormalizedPlay } from "./normalize.js";

const MAX_FILES = 10;
const BATCH_SIZE = 500;
const dateString = z.string().datetime({ offset: true });
const historyQuery = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(50), from: dateString.optional(), to: dateString.optional(), source: z.enum(["IMPORT", "SPOTIFY_API", "ALL"]).default("ALL") });

type FileResult = { importId: string | null; filename: string; status: string; totalRecords: number; importedRecords: number; skippedRecords: number; failedRecords: number; error?: string };

async function processFile(userId: string, filenameInput: string, bytes: Buffer): Promise<FileResult> {
  const filename = path.basename(filenameInput).slice(0, 255) || "spotify-history.json";
  const fileChecksum = createHash("sha256").update(bytes).digest("hex");
  let historyImport = await prisma.historyImport.findUnique({ where: { userId_fileChecksum: { userId, fileChecksum } } });
  if (historyImport && ["COMPLETED", "PROCESSING"].includes(historyImport.status)) {
    return { importId: historyImport.id, filename, status: historyImport.status, totalRecords: historyImport.totalRecords, importedRecords: historyImport.importedRecords, skippedRecords: historyImport.skippedRecords, failedRecords: historyImport.failedRecords };
  }
  if (!historyImport) historyImport = await prisma.historyImport.create({ data: { userId, filename, fileChecksum, status: "PROCESSING" } });
  else historyImport = await prisma.historyImport.update({ where: { id: historyImport.id }, data: { filename, status: "PROCESSING", totalRecords: 0, skippedRecords: 0, failedRecords: 0, earliestPlayedAt: null, latestPlayedAt: null, errorSummary: null, completedAt: null, startedAt: new Date() } });

  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!Array.isArray(parsed)) throw new Error("Expected the Spotify export file to contain a JSON array.");
    const priorImportedRecords = historyImport.importedRecords;
    let importedRecords = 0;
    let skippedRecords = 0;
    let failedRecords = 0;
    let earliest: Date | null = null;
    let latest: Date | null = null;
    const seen = new Set<string>();
    for (let offset = 0; offset < parsed.length; offset += BATCH_SIZE) {
      const records = parsed.slice(offset, offset + BATCH_SIZE);
      const normalized: NormalizedPlay[] = [];
      for (const record of records) {
        try {
          const play = normalizeExportRecord(record);
          if (seen.has(play.dedupeKey)) { skippedRecords += 1; continue; }
          seen.add(play.dedupeKey);
          normalized.push(play);
        } catch { failedRecords += 1; }
      }
      if (normalized.length) {
        const keys = normalized.map((play) => play.dedupeKey);
        const apiDuplicates = await prisma.listeningEvent.findMany({ where: { userId, dedupeKey: { in: keys }, source: "SPOTIFY_API" }, select: { dedupeKey: true } });
        const upgradeKeys = new Set(apiDuplicates.flatMap((row) => row.dedupeKey ? [row.dedupeKey] : []));
        const upgraded = normalized.filter((play) => upgradeKeys.has(play.dedupeKey));
        for (const play of upgraded) {
          await prisma.listeningEvent.updateMany({ where: { userId, dedupeKey: play.dedupeKey, source: "SPOTIFY_API" }, data: { ...play, source: "IMPORT", importId: historyImport.id } });
        }
        const toCreate = normalized.filter((play) => !upgradeKeys.has(play.dedupeKey));
        const created = toCreate.length ? await prisma.listeningEvent.createMany({
          data: toCreate.map((play) => ({ ...play, userId, source: "IMPORT" as const, importId: historyImport.id })),
          skipDuplicates: true,
        }) : { count: 0 };
        importedRecords += upgraded.length + created.count;
        skippedRecords += toCreate.length - created.count;
        for (const play of normalized) {
          if (!earliest || play.playedAt < earliest) earliest = play.playedAt;
          if (!latest || play.playedAt > latest) latest = play.playedAt;
        }
      }
      await prisma.historyImport.update({ where: { id: historyImport.id }, data: { totalRecords: Math.min(offset + records.length, parsed.length), importedRecords: priorImportedRecords + importedRecords, skippedRecords, failedRecords } });
    }
    const totalImported = priorImportedRecords + importedRecords;
    const status = failedRecords ? (totalImported ? "PARTIAL" : "FAILED") : "COMPLETED";
    const saved = await prisma.historyImport.update({ where: { id: historyImport.id }, data: { status, totalRecords: parsed.length, importedRecords: totalImported, skippedRecords, failedRecords, earliestPlayedAt: earliest ?? historyImport.earliestPlayedAt, latestPlayedAt: latest ?? historyImport.latestPlayedAt, completedAt: new Date(), errorSummary: failedRecords ? `${failedRecords} record(s) were invalid or lacked track metadata.` : null } });
    return { importId: saved.id, filename, status: saved.status, totalRecords: parsed.length, importedRecords: totalImported, skippedRecords, failedRecords, ...(saved.errorSummary ? { error: saved.errorSummary } : {}) };
  } catch (error) {
    const message = error instanceof SyntaxError ? "Invalid JSON file." : error instanceof Error && error.message.startsWith("Expected") ? error.message : "Could not process this JSON file.";
    const saved = await prisma.historyImport.update({ where: { id: historyImport.id }, data: { status: "FAILED", failedRecords: Math.max(1, historyImport.failedRecords), completedAt: new Date(), errorSummary: message } });
    return { importId: saved.id, filename, status: saved.status, totalRecords: saved.totalRecords, importedRecords: saved.importedRecords, skippedRecords: saved.skippedRecords, failedRecords: saved.failedRecords, error: message };
  }
}

export async function historyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/history/import", { bodyLimit: 251 * 1024 * 1024, preHandler: [requireSession], schema: { tags: ["history"], summary: "Import Spotify extended streaming history JSON" } }, async (request, reply) => {
    const results: FileResult[] = [];
    let fileCount = 0;
    try {
      for await (const part of request.parts({ limits: { files: MAX_FILES, fileSize: 25 * 1024 * 1024, parts: MAX_FILES } })) {
        if (part.type !== "file") continue;
        fileCount += 1;
        const name = part.filename || "spotify-history.json";
        try {
          const bytes = await part.toBuffer();
          results.push(await processFile(request.userId!, name, bytes));
        } catch {
          results.push({ importId: null, filename: path.basename(name).slice(0, 255), status: "FAILED", totalRecords: 0, importedRecords: 0, skippedRecords: 0, failedRecords: 1, error: "File exceeded the upload limit or could not be read." });
        }
      }
    } catch {
      return reply.code(413).send({ error: { code: "UPLOAD_LIMIT", message: "Upload up to 10 JSON files, each no larger than 25 MB." } });
    }
    if (!fileCount) return reply.code(400).send({ error: { code: "NO_FILES", message: "Select one or more JSON files to import." } });
    return reply.code(202).send({ data: { imports: results } });
  });

  app.get("/history/imports", { preHandler: [requireSession], schema: { tags: ["history"], summary: "List history imports" } }, async (request) => {
    const imports = await prisma.historyImport.findMany({ where: { userId: request.userId! }, orderBy: { startedAt: "desc" }, take: 100 });
    return { data: imports };
  });

  app.get<{ Params: { id: string } }>("/history/imports/:id", { preHandler: [requireSession], schema: { tags: ["history"], summary: "Get an import status" } }, async (request, reply) => {
    const item = await prisma.historyImport.findFirst({ where: { id: request.params.id, userId: request.userId! } });
    if (!item) return reply.code(404).send({ error: { code: "IMPORT_NOT_FOUND", message: "Import not found." } });
    return { data: item };
  });

  app.delete<{ Params: { id: string } }>("/history/imports/:id", { preHandler: [requireSession], schema: { tags: ["history"], summary: "Delete an import and its listening events" } }, async (request, reply) => {
    const deleted = await prisma.historyImport.deleteMany({ where: { id: request.params.id, userId: request.userId! } });
    if (!deleted.count) return reply.code(404).send({ error: { code: "IMPORT_NOT_FOUND", message: "Import not found." } });
    return { data: { deleted: true } };
  });

  app.get<{ Querystring: Record<string, string | undefined> }>("/history", { preHandler: [requireSession], schema: { tags: ["history"], summary: "Paginated listening history" } }, async (request, reply) => {
    const query = historyQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: { code: "INVALID_QUERY", message: "Invalid history filters." } });
    const { cursor, limit, from, to, source } = query.data;
    const where = { userId: request.userId!, ...(source === "ALL" ? {} : { source }), ...(from || to ? { playedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}) };
    const data = await prisma.listeningEvent.findMany({ where, orderBy: [{ playedAt: "desc" }, { id: "desc" }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, trackName: true, artistName: true, albumName: true, playedAt: true, msPlayed: true, source: true, skipped: true, shuffle: true } });
    const hasMore = data.length > limit;
    if (hasMore) data.pop();
    return { data, page: { nextCursor: hasMore ? data.at(-1)?.id ?? null : null, hasMore, limit } };
  });
}

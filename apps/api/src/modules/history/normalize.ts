import { z } from "zod";
import { sha256 } from "../../utils/crypto.js";

const nullableText = z.string().nullable().optional();
export const exportRecordSchema = z.object({
  ts: z.string().min(1),
  ms_played: z.number().int().nonnegative(),
  master_metadata_track_name: nullableText,
  master_metadata_album_artist_name: nullableText,
  master_metadata_album_album_name: nullableText,
  spotify_track_uri: nullableText,
  reason_start: nullableText,
  reason_end: nullableText,
  shuffle: z.boolean().nullable().optional(),
  skipped: z.boolean().nullable().optional(),
  offline: z.boolean().nullable().optional(),
  incognito_mode: z.boolean().nullable().optional(),
}).passthrough();

export type NormalizedPlay = {
  dedupeKey: string;
  trackSpotifyId: string | null;
  trackUri: string | null;
  trackName: string;
  artistName: string;
  albumName: string | null;
  playedAt: Date;
  msPlayed: number;
  skipped: boolean | null;
  shuffle: boolean | null;
};

export function stablePlayKey(playedAt: Date, trackUri: string | null, trackName: string, artistName: string): string {
  return sha256([playedAt.toISOString(), trackUri ?? "", trackName, artistName].join("\u001f"));
}

export function normalizeExportRecord(value: unknown): NormalizedPlay {
  const record = exportRecordSchema.parse(value);
  const playedAt = new Date(record.ts);
  if (!Number.isFinite(playedAt.getTime())) throw new Error("Invalid ts timestamp");
  const trackName = record.master_metadata_track_name?.trim();
  const artistName = record.master_metadata_album_artist_name?.trim();
  if (!trackName || !artistName) throw new Error("Record has no track or album artist metadata");
  const trackUri = record.spotify_track_uri ?? null;
  const trackSpotifyId = trackUri?.match(/^spotify:track:([A-Za-z0-9]+)$/)?.[1] ?? null;
  return {
    dedupeKey: stablePlayKey(playedAt, trackUri, trackName, artistName), trackSpotifyId, trackUri, trackName, artistName,
    albumName: record.master_metadata_album_album_name ?? null, playedAt, msPlayed: record.ms_played,
    skipped: record.skipped ?? null, shuffle: record.shuffle ?? null,
  };
}

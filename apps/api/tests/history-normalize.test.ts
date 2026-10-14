import { describe, expect, it } from "vitest";
import { normalizeExportRecord } from "../src/modules/history/normalize.js";

const record = { ts: "2024-01-01T08:00:00Z", ms_played: 245000, master_metadata_track_name: "Song", master_metadata_album_artist_name: "Artist", master_metadata_album_album_name: "Album", spotify_track_uri: "spotify:track:abc123", skipped: false, shuffle: true };

describe("Spotify extended history normalization", () => {
  it("normalizes UTC timestamps and track identifiers", () => {
    const play = normalizeExportRecord(record);
    expect(play.playedAt.toISOString()).toBe("2024-01-01T08:00:00.000Z");
    expect(play.trackSpotifyId).toBe("abc123");
    expect(play.msPlayed).toBe(245000);
    expect(play.shuffle).toBe(true);
  });

  it("creates the same dedupe identity for an identical listening event", () => {
    expect(normalizeExportRecord(record).dedupeKey).toBe(normalizeExportRecord(record).dedupeKey);
    expect(normalizeExportRecord(record).dedupeKey).not.toBe(normalizeExportRecord({ ...record, ts: "2024-01-01T08:00:01Z" }).dedupeKey);
  });

  it("rejects records without the metadata needed for a track statistic", () => {
    expect(() => normalizeExportRecord({ ...record, master_metadata_album_artist_name: null })).toThrow();
  });
});

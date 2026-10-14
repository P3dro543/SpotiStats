import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.env") });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_URL: z.string().url().optional(),
  SESSION_SECRET: z.string().min(32).optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().url().default("http://localhost:3001/api/v1/auth/spotify/callback"),
});

export const env = schema.parse(process.env);
export const spotifyConfigured = Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET);
if (env.NODE_ENV === "production") {
  if (!env.DATABASE_URL || !env.SESSION_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
    throw new Error("Production requires a database URL, session secret, and token encryption key.");
  }
  const decodedEncryptionKey = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64");
  if (decodedEncryptionKey.byteLength !== 32 || decodedEncryptionKey.toString("base64") !== env.TOKEN_ENCRYPTION_KEY) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be a canonical base64 encoded 32-byte key.");
  }
  if (!env.WEB_ORIGIN.startsWith("https://")) {
    throw new Error("Production web origin must use HTTPS.");
  }
  if (spotifyConfigured && !env.SPOTIFY_REDIRECT_URI.startsWith("https://")) {
    throw new Error("Production Spotify callback URI must use HTTPS.");
  }
}

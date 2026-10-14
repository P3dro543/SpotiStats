import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { decryptSecret, encryptSecret } from "../../utils/crypto.js";

const API_ROOT = "https://api.spotify.com/v1";
const TOKEN_ENDPOINT = "https://accounts.spotify.com/api/token";
type TokenResponse = { access_token: string; expires_in: number; refresh_token?: string; scope?: string };

export class SpotifyError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = "SpotifyError"; }
}

async function refreshAccessToken(userId: string, force = false): Promise<string> {
  const connection = await prisma.spotifyConnection.findUnique({ where: { userId } });
  if (!connection) throw new SpotifyError(401, "Spotify is not connected");
  if (!force && connection.expiresAt.getTime() > Date.now() + 60_000) return decryptSecret(connection.accessTokenEncrypted);
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) throw new SpotifyError(503, "Spotify integration is not configured");
  const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptSecret(connection.refreshTokenEncrypted) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      await prisma.spotifyConnection.deleteMany({ where: { userId } });
      throw new SpotifyError(401, "Spotify authorization expired; reconnect your account.");
    }
    throw new SpotifyError(response.status, "Spotify token refresh failed");
  }
  const tokens = await response.json() as TokenResponse;
  await prisma.spotifyConnection.update({
    where: { userId },
    data: {
      accessTokenEncrypted: encryptSecret(tokens.access_token),
      ...(tokens.refresh_token ? { refreshTokenEncrypted: encryptSecret(tokens.refresh_token) } : {}),
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      ...(tokens.scope ? { grantedScopes: tokens.scope.split(" ").filter(Boolean) } : {}),
    },
  });
  return tokens.access_token;
}

export async function spotifyRequest<T>(userId: string, path: string, retriedAuth = false): Promise<T> {
  if (!path.startsWith("/")) throw new Error("Spotify API path must be relative");
  const token = await refreshAccessToken(userId, retriedAuth);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${API_ROOT}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (response.status === 401 && !retriedAuth) return spotifyRequest<T>(userId, path, true);
    if (response.status === 429) {
      const retryAfter = Math.min(Number(response.headers.get("retry-after") ?? "1"), 10);
      if (attempt < 2) { await new Promise((resolve) => setTimeout(resolve, Math.max(1, retryAfter) * 1000)); continue; }
      throw new SpotifyError(429, "Spotify rate limit reached. Retry later.");
    }
    if (response.status >= 500 && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500)); continue; }
    if (!response.ok) throw new SpotifyError(response.status, response.status === 403 ? "Spotify denied this request; check the granted permissions and app access." : "Spotify request failed");
    return response.json() as Promise<T>;
  }
  throw new SpotifyError(502, "Spotify request failed after retries");
}

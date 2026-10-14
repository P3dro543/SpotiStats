import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, spotifyConfigured } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { encryptSecret, sessionDigest } from "../../utils/crypto.js";
import { clearSessionCookies, issueSession, requireSession, SESSION_COOKIE, CSRF_COOKIE } from "./session.js";

const scopes = ["user-read-private", "user-read-recently-played", "user-top-read"];
const stateCookie = "ss_oauth_state";
const baseCookie = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: env.NODE_ENV === "production" };
const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number().int().positive(), scope: z.string() });
const profileSchema = z.object({ account_id: z.string().optional(), id: z.string(), display_name: z.string().nullable().optional(), email: z.string().email().optional(), country: z.string().optional() });

function safeStateEquals(a: string, b: string): boolean {
  const first = Buffer.from(a);
  const second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get("/spotify", { schema: { tags: ["auth"], summary: "Start Spotify OAuth" } }, async (_request, reply) => {
    if (!spotifyConfigured || !env.SPOTIFY_CLIENT_ID) return reply.code(503).send({ error: { code: "SPOTIFY_NOT_CONFIGURED", message: "Spotify OAuth is unavailable until server credentials are configured." } });
    const state = randomBytes(32).toString("base64url");
    reply.setCookie(stateCookie, state, { ...baseCookie, maxAge: 600 });
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({ response_type: "code", client_id: env.SPOTIFY_CLIENT_ID, redirect_uri: env.SPOTIFY_REDIRECT_URI, scope: scopes.join(" "), state }).toString();
    return reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/spotify/callback", { schema: { tags: ["auth"], summary: "Complete Spotify OAuth" } }, async (request, reply) => {
    const { code, state, error } = request.query;
    const expectedState = request.cookies[stateCookie];
    reply.clearCookie(stateCookie, { path: "/", sameSite: "lax", secure: env.NODE_ENV === "production" });
    if (error || !code || !state || !expectedState || !safeStateEquals(state, expectedState)) {
      return reply.redirect(`${env.WEB_ORIGIN}/?spotify=${error === "access_denied" ? "denied" : "oauth_error"}`);
    }
    if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return reply.redirect(`${env.WEB_ORIGIN}/?spotify=unconfigured`);
    try {
      const basic = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
      const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.SPOTIFY_REDIRECT_URI }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!tokenResponse.ok) return reply.redirect(`${env.WEB_ORIGIN}/?spotify=token_error`);
      const tokens = tokenSchema.parse(await tokenResponse.json());
      const profileResponse = await fetch("https://api.spotify.com/v1/me", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000) });
      if (!profileResponse.ok) return reply.redirect(`${env.WEB_ORIGIN}/?spotify=profile_error`);
      const profile = profileSchema.parse(await profileResponse.json());
      const spotifyUserId = profile.account_id ?? profile.id;
      const user = await prisma.user.upsert({
        where: { spotifyUserId },
        create: { spotifyUserId, displayName: profile.display_name ?? null, ...(profile.email ? { email: profile.email } : {}), ...(profile.country ? { country: profile.country } : {}) },
        update: { displayName: profile.display_name ?? null, ...(profile.email ? { email: profile.email } : {}), ...(profile.country ? { country: profile.country } : {}) },
      });
      await prisma.spotifyConnection.upsert({
        where: { userId: user.id },
        create: { userId: user.id, accessTokenEncrypted: encryptSecret(tokens.access_token), refreshTokenEncrypted: encryptSecret(tokens.refresh_token), expiresAt: new Date(Date.now() + tokens.expires_in * 1000), grantedScopes: tokens.scope.split(" ").filter(Boolean) },
        update: { accessTokenEncrypted: encryptSecret(tokens.access_token), refreshTokenEncrypted: encryptSecret(tokens.refresh_token), expiresAt: new Date(Date.now() + tokens.expires_in * 1000), grantedScopes: tokens.scope.split(" ").filter(Boolean), connectedAt: new Date() },
      });
      const oldSession = request.cookies[SESSION_COOKIE];
      if (oldSession) await prisma.appSession.deleteMany({ where: { id: sessionDigest(oldSession) } });
      await issueSession(user.id, reply);
      return reply.redirect(`${env.WEB_ORIGIN}/?spotify=connected`);
    } catch {
      return reply.redirect(`${env.WEB_ORIGIN}/?spotify=oauth_error`);
    }
  });

  app.get("/session", { schema: { tags: ["auth"], summary: "Get current session" } }, async (request, reply) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return { data: { authenticated: false, spotifyConfigured } };
    const session = await prisma.appSession.findUnique({ where: { id: sessionDigest(raw) }, include: { user: { include: { connection: true } } } });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await prisma.appSession.deleteMany({ where: { id: session.id } });
      clearSessionCookies(reply);
      return { data: { authenticated: false, spotifyConfigured } };
    }
    let csrfToken = request.cookies[CSRF_COOKIE];
    if (!csrfToken) csrfToken = issueCsrf(reply);
    return { data: { authenticated: true, csrfToken, spotifyConfigured, user: { id: session.user.id, displayName: session.user.displayName, spotifyConnected: Boolean(session.user.connection), grantedScopes: session.user.connection?.grantedScopes ?? [] } } };
  });

  app.post("/logout", { preHandler: [requireSession], schema: { tags: ["auth"], summary: "End current session" } }, async (request, reply) => {
    if (request.sessionId) await prisma.appSession.deleteMany({ where: { id: request.sessionId } });
    clearSessionCookies(reply);
    return { data: { loggedOut: true } };
  });

  app.delete("/spotify", { preHandler: [requireSession], schema: { tags: ["auth"], summary: "Disconnect Spotify and delete stored tokens" } }, async (request) => {
    await prisma.spotifyConnection.deleteMany({ where: { userId: request.userId! } });
    await prisma.syncRun.deleteMany({ where: { userId: request.userId! } });
    await prisma.topItemSnapshot.deleteMany({ where: { userId: request.userId! } });
    return { data: { disconnected: true } };
  });

  app.delete("/account", { preHandler: [requireSession], schema: { tags: ["auth"], summary: "Delete the account and all associated data" } }, async (request, reply) => {
    await prisma.user.deleteMany({ where: { id: request.userId! } });
    clearSessionCookies(reply);
    return { data: { deleted: true } };
  });
}

function issueCsrf(reply: import("fastify").FastifyReply): string {
  const token = randomBytes(32).toString("base64url");
  reply.setCookie(CSRF_COOKIE, token, { path: "/", httpOnly: false, sameSite: "lax", secure: env.NODE_ENV === "production", maxAge: 30 * 24 * 60 * 60 });
  return token;
}

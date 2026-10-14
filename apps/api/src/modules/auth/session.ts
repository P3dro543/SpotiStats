import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { sessionDigest } from "../../utils/crypto.js";
import { env } from "../../config/env.js";

export const SESSION_COOKIE = "ss_session";
export const CSRF_COOKIE = "ss_csrf";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const cookieBase = { path: "/", sameSite: "lax" as const, secure: env.NODE_ENV === "production" };

export async function issueSession(userId: string, reply: FastifyReply): Promise<void> {
  const rawSession = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.appSession.create({ data: { id: sessionDigest(rawSession), userId, expiresAt } });
  reply.setCookie(SESSION_COOKIE, rawSession, { ...cookieBase, httpOnly: true, expires: expiresAt });
  setCsrfCookie(reply);
}

export function setCsrfCookie(reply: FastifyReply): string {
  const token = randomBytes(32).toString("base64url");
  reply.setCookie(CSRF_COOKIE, token, { ...cookieBase, httpOnly: false, maxAge: SESSION_TTL_MS / 1000 });
  return token;
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, cookieBase);
  reply.clearCookie(CSRF_COOKIE, cookieBase);
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const rawSession = request.cookies[SESSION_COOKIE];
  if (!rawSession) {
    await reply.code(401).send({ error: { code: "UNAUTHENTICATED", message: "Please connect your Spotify account." } });
    return;
  }
  const session = await prisma.appSession.findUnique({ where: { id: sessionDigest(rawSession) } });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.appSession.deleteMany({ where: { id: session.id } });
    clearSessionCookies(reply);
    await reply.code(401).send({ error: { code: "SESSION_EXPIRED", message: "Your session expired. Please reconnect." } });
    return;
  }
  request.userId = session.userId;
  request.sessionId = session.id;
}

export async function verifyCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookie = request.cookies[CSRF_COOKIE];
  const header = request.headers["x-csrf-token"];
  if (!cookie || typeof header !== "string" || cookie !== header) {
    await reply.code(403).send({ error: { code: "CSRF_INVALID", message: "The request could not be verified." } });
  }
}

export async function requireSession(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await authenticate(request, reply);
  if (reply.sent) return;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) await verifyCsrf(request, reply);
}

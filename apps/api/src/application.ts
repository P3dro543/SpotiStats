import Fastify, { LogController, type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { SpotifyError } from "./modules/spotify/client.js";
import { authRoutes } from "./modules/auth/routes.js";
import { analyticsRoutes } from "./modules/analytics/routes.js";
import { historyRoutes } from "./modules/history/routes.js";
import { spotifyRoutes } from "./modules/spotify/routes.js";
import { privacyRoutes } from "./modules/privacy/routes.js";

export async function buildApp() {
  const app = Fastify({ bodyLimit: 1024 * 1024, logController: new LogController({ disableRequestLogging: true }), logger: { redact: ["req.headers.authorization", "req.headers.cookie", "req.url", "*.accessToken", "*.refreshToken"] } });
  app.decorateRequest("userId", null);
  app.decorateRequest("sessionId", null);
  await app.register(helmet);
  await app.register(cors, { origin: env.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { files: 10, fileSize: 25 * 1024 * 1024, parts: 10 } });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  await app.register(swagger, { openapi: { info: { title: "Spotify Stats API", version: "1.0.0" } } });
  await app.register(swaggerUi, { routePrefix: "/documentation" });

  app.get("/api/v1/health", { schema: { tags: ["health"], summary: "API liveness" } }, async () => ({ data: { status: "ok", databaseConfigured: Boolean(env.DATABASE_URL), spotifyConfigured: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET) } }));

  await app.register(async (api) => {
    await api.register(authRoutes, { prefix: "/auth" });
    await api.register(analyticsRoutes);
    await api.register(historyRoutes);
    await api.register(spotifyRoutes);
    await api.register(privacyRoutes);
  }, { prefix: "/api/v1" });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof SpotifyError) {
      const status = [401, 403, 429, 502, 503].includes(error.status) ? error.status : 502;
      return reply.code(status).send({ error: { code: error.status === 401 ? "SPOTIFY_REAUTH_REQUIRED" : error.status === 429 ? "SPOTIFY_RATE_LIMIT" : "SPOTIFY_REQUEST_FAILED", message: error.message } });
    }
    if (error.statusCode === 413) return reply.code(413).send({ error: { code: "PAYLOAD_TOO_LARGE", message: "The request exceeds the configured size limit." } });
    request.log.error({ errorType: error.name }, "Request failed");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } });
  });

  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } }));
  app.addHook("onClose", async () => prisma.$disconnect());
  return app;
}

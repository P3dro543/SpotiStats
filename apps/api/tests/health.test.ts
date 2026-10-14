import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("GET /api/v1/health", () => {
  it("returns a consistent healthy response", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.status).toBe("ok");
    expect(typeof body.data.databaseConfigured).toBe("boolean");
    expect(typeof body.data.spotifyConfigured).toBe("boolean");
    await app.close();
  }, 15000);
});

describe("protected API routes", () => {
  it("rejects unauthenticated analytics requests", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/analytics/top-tracks" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("does not fake Spotify OAuth when server credentials are missing", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/v1/auth/spotify" });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("SPOTIFY_NOT_CONFIGURED");
    await app.close();
  });
});

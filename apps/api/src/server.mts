import { env } from "./config/env.js";
import { buildApp } from "./application.js";

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: env.API_PORT });

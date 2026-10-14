import { env } from "./config/env.js";
import { buildApp } from "./application.mjs";

const app = await buildApp();
const port = Number(process.env.PORT ?? env.API_PORT);
await app.listen({ host: "0.0.0.0", port });

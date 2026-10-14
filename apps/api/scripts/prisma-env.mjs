import dotenv from "dotenv";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(scriptDirectory, "../../../.env") });

const prismaCli = resolve(scriptDirectory, "../node_modules/prisma/build/index.js");
const result = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  process.stderr.write("Could not start Prisma CLI.\n");
  process.exit(1);
}
process.exit(result.status ?? 1);

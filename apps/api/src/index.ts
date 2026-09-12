import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import mongoose from "mongoose";
import MongoStore from "connect-mongo";
import { createApp } from "./app.js";
import { MongoKitStore, MongoUserStore } from "./store/mongoStore.js";

// Loaded from the repo-root .env regardless of process.cwd() — npm sets cwd to this
// package's own directory when this script is launched via `npm run dev --workspace=apps/api`
// (i.e. the root `dev:api` script), so the default `dotenv/config` (which only checks
// process.cwd()) would silently miss a root-level .env entirely.
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });
const PORT = Number(process.env.PORT ?? 4000);
const MONGODB_URI = process.env.MONGODB_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;

async function main() {
  if (!MONGODB_URI) throw new Error("MONGODB_URI is required — see .env.example");
  if (!SESSION_SECRET) throw new Error("SESSION_SECRET is required — see .env.example");

  await mongoose.connect(MONGODB_URI);

  const app = createApp({
    userStore: new MongoUserStore(),
    kitStore: new MongoKitStore(),
    sessionStore: MongoStore.create({ mongoUrl: MONGODB_URI }),
    sessionSecret: SESSION_SECRET,
    corsOrigin: process.env.CORS_ORIGIN,
  });

  app.listen(PORT, () => console.log(`API listening on :${PORT}`));
}

main().catch((err) => {
  console.error("Failed to start API:", err);
  process.exit(1);
});

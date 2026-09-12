// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Exercises ONLY packages/core's Gemini transport directly: real auth, real endpoint,
// real model, real request/response shape, real retry/schema-validation loop.
// No MongoDB, no Express, no frontend, no other env vars involved.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { createGeminiTransport, createLLMCaller } from "@trao/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, ".env") });

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("RESULT: GEMINI_API_KEY is not set in .env — nothing to test yet.");
    console.log("Add it to the repo-root .env, then re-run this script.");
    return;
  }

  console.log(`Using model: ${process.env.GEMINI_MODEL || "(default) gemini-3.8-flash"}`);
  console.log("Calling the real Gemini API with a trivial prompt...\n");

  const transport = createGeminiTransport({
    apiKey,
    model: process.env.GEMINI_MODEL,
    baseUrl: process.env.GEMINI_BASE_URL,
  });
  const call = createLLMCaller(transport);

  const schema = z.object({
    acknowledged: z.boolean(),
    message: z.string(),
  });

  const start = Date.now();
  const result = await call(
    'Return ONLY JSON matching exactly: { "acknowledged": true, "message": "pong" }. No other text, no markdown fences.',
    schema
  );
  const elapsedMs = Date.now() - start;

  console.log(`Elapsed: ${elapsedMs}ms, attempts used: ${result.attempts}`);
  if (result.ok) {
    console.log("RESULT: SUCCESS");
    console.log("Parsed response:", JSON.stringify(result.data));
  } else {
    console.log("RESULT: FAILED");
    console.log(`Reason: ${result.reason}`);
    console.log(`Message: ${result.message}`);
  }
}

main().catch((err) => {
  console.error("Smoke test threw an unexpected error:", err);
  process.exitCode = 1;
});

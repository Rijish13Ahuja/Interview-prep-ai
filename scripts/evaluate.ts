#!/usr/bin/env tsx
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  BatchInputSchema,
  createGeminiTransport,
  createGoogleCseSearch,
  createLLMCaller,
  crawlCompanySite,
  runBatch,
  type DiscussionSearch,
  type PipelineDeps,
} from "@trao/core";

// Loaded from the repo-root .env explicitly, rather than relying on dotenv's default
// process.cwd()-based lookup — this way the command behaves identically whether it's
// invoked as `npm run evaluate` from the root (the documented usage) or any other way.
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });

function parseArgs(argv: string[]): { input: string; output: string } {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" || argv[i] === "--output") {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  if (!args.input || !args.output) {
    throw new Error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
  }
  return { input: args.input, output: args.output };
}

function buildDiscussionSearch(): DiscussionSearch | null {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return null; // optional — degrades to an honest "not_configured" state
  return createGoogleCseSearch({ apiKey, cx });
}

function buildDeps(): PipelineDeps {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required — see .env.example");
  }

  const transport = createGeminiTransport({
    apiKey,
    model: process.env.GEMINI_MODEL,
    baseUrl: process.env.GEMINI_BASE_URL, // override only for local testing against a mock server
  });

  const allowLoopback = process.env.ALLOW_LOOPBACK_URLS === "true";

  return {
    call: createLLMCaller(transport),
    discussionSearch: buildDiscussionSearch(),
    crawl: crawlCompanySite,
    crawlOptions: { allowLoopback },
  };
}

async function main() {
  const { input, output } = parseArgs(process.argv.slice(2));

  const rawInput = await readFile(input, "utf-8");
  const cases = BatchInputSchema.parse(JSON.parse(rawInput));

  const deps = buildDeps();
  const result = await runBatch(cases, deps);

  await writeFile(output, JSON.stringify(result, null, 2), "utf-8");

  const okCount = result.kits.filter((k) => k.status === "ok").length;
  console.log(`Wrote ${result.kits.length} result(s) to ${output} (${okCount} ok, ${result.kits.length - okCount} failed)`);
}

main().catch((err) => {
  console.error("Batch evaluation failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

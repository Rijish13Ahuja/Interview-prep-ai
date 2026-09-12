// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Exercises the REAL, unmodified extractRequirements() production function against a
// real Gemini call. No mocks, no fakes, no MongoDB, no Express involvement.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createGeminiTransport, createLLMCaller, extractRequirements } from "@trao/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, ".env") });

const JD = `Senior Backend Engineer — Remote

We are looking for a Senior Backend Engineer to join our growing platform team.

Responsibilities:
- Design and build scalable REST APIs
- Mentor junior engineers

Requirements:
- 5+ years of experience with Node.js is required
- Strong understanding of relational databases is required
- Experience with GraphQL is a nice to have`;

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log("RESULT: GEMINI_API_KEY is not set — nothing to test.");
    return;
  }

  const transport = createGeminiTransport({
    apiKey,
    model: process.env.GEMINI_MODEL,
    baseUrl: process.env.GEMINI_BASE_URL,
  });
  const call = createLLMCaller(transport);

  console.log(`Model: ${process.env.GEMINI_MODEL?.trim() || "(default) gemini-3.8-flash"}`);
  console.log("Calling the real extractRequirements() with a real Gemini call...\n");

  const start = Date.now();
  const outcome = await extractRequirements(JD, call);
  const elapsedMs = Date.now() - start;

  console.log(`Elapsed: ${elapsedMs}ms`);
  console.log(`fatal: ${outcome.fatal}`);
  if (outcome.fatal) {
    console.log("RESULT: FAILED (fatal)");
    console.log(`errorMessage: ${outcome.errorMessage}`);
    return;
  }

  console.log("RESULT: SUCCESS (non-fatal outcome)");
  console.log(JSON.stringify(
    {
      title: outcome.title,
      seniority: outcome.seniority,
      location: outcome.location,
      responsibilities: outcome.responsibilities,
      requirements: outcome.requirements,
    },
    null,
    2
  ));
}

main().catch((err) => {
  console.error("Extraction test threw an unexpected error:", err);
  process.exitCode = 1;
});

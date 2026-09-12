// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Calls the REAL, unmodified generateQuestionsForCategory() with a "spy" LLMCaller that
// captures the full StepResult (ok/attempts/data or reason/message) which the production
// function itself discards on failure (returns [] silently). No production code modified.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createGeminiTransport,
  createLLMCaller,
  generateQuestionsForCategory,
  type Requirement,
  type LLMCaller,
  type StepResult,
} from "@trao/core";
import type { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, ".env") });

// Reused verbatim from the earlier real, validated extraction test (Phase 2) — same
// three "technical"-kind requirements, real ids, real evidence quotes.
const REQUIREMENTS: Requirement[] = [
  { id: "r1", text: "5+ years of experience with Node.js", kind: "technical", priority: "must", evidence: "5+ years of experience with Node.js is required" },
  { id: "r2", text: "Strong understanding of relational databases", kind: "technical", priority: "must", evidence: "Strong understanding of relational databases is required" },
  { id: "r3", text: "Experience with GraphQL", kind: "technical", priority: "nice", evidence: "Experience with GraphQL is a nice to have" },
];
const ROLE_CONTEXT = { title: "Senior Backend Engineer", seniority: "Senior" };

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
  const realCall = createLLMCaller(transport);

  let captured: StepResult<unknown> | null = null;
  const spyCall: LLMCaller = async <T>(prompt: string, schema: z.ZodType<T>) => {
    const result = await realCall(prompt, schema);
    captured = result as StepResult<unknown>;
    return result;
  };

  console.log(`Model: ${process.env.GEMINI_MODEL?.trim() || "(default) gemini-3.8-flash"}`);
  console.log("Calling the real generateQuestionsForCategory('technical') with an instrumented LLMCaller...\n");

  const start = Date.now();
  const questions = await generateQuestionsForCategory(
    { category: "technical", requirements: REQUIREMENTS, roleContext: ROLE_CONTEXT },
    spyCall,
    1
  );
  const elapsedMs = Date.now() - start;

  console.log(`Elapsed: ${elapsedMs}ms\n`);
  console.log("=== Captured StepResult (normally discarded on failure by generateQuestionsForCategory) ===");
  console.log(JSON.stringify(captured, null, 2));

  console.log("\n=== generateQuestionsForCategory's actual returned Question[] ===");
  console.log(JSON.stringify(questions, null, 2));

  console.log("\n=== Cross-check: requirement_ids vs known supplied ids ===");
  const knownIds = new Set(REQUIREMENTS.map((r) => r.id));
  for (const q of questions) {
    const allValid = q.requirement_ids.every((id) => knownIds.has(id));
    console.log(`${q.id}: requirement_ids=${JSON.stringify(q.requirement_ids)} — all reference known requirements: ${allValid}`);
  }
  console.log(`\nTotal questions generated: ${questions.length}`);
}

main().catch((err) => {
  console.error("Question generation test threw an unexpected error:", err);
  process.exitCode = 1;
});

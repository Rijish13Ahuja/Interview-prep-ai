// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Calls the REAL, unmodified generateQuestionsForCategory() for the "behavioural" category
// with a "spy" LLMCaller capturing the full StepResult the production function discards
// on failure. No production code modified.
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

// Adapted from the real extraction test's JD — "Mentor junior engineers" was extracted
// as a responsibility, not a requirement, by the real Gemini extraction run. This one
// behavioural-kind requirement is constructed here (not itself real extraction output)
// solely to exercise the "behavioural" category the way generateQuestionsForCategory is
// actually invoked in production (only behavioural-kind requirements are ever routed to it).
const REQUIREMENTS: Requirement[] = [
  { id: "r4", text: "Experience mentoring junior engineers", kind: "behavioural", priority: "nice", evidence: "Mentor junior engineers" },
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
  console.log("Calling the real generateQuestionsForCategory('behavioural') with an instrumented LLMCaller...\n");

  const start = Date.now();
  const questions = await generateQuestionsForCategory(
    { category: "behavioural", requirements: REQUIREMENTS, roleContext: ROLE_CONTEXT },
    spyCall,
    1
  );
  const elapsedMs = Date.now() - start;

  console.log(`Elapsed: ${elapsedMs}ms\n`);
  console.log("=== Captured StepResult ===");
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
  console.error("Behavioural question generation test threw an unexpected error:", err);
  process.exitCode = 1;
});

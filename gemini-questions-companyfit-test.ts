// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Calls the REAL, unmodified generateQuestionsForCategory() for the "company-fit" category
// with a "spy" LLMCaller capturing the full StepResult. No production code modified.
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

// Production always passes an empty requirements array for "company-fit"
// (orchestrator.ts: `{ category: "company-fit", requirements: [] }`).
const REQUIREMENTS: Requirement[] = [];
const ROLE_CONTEXT = { title: "Senior Backend Engineer", seniority: "Senior" };

// Real, validated Gemini output from the earlier successful Company Brief test — this is
// exactly what would flow into companyContext in production (brief.summary).
const COMPANY_CONTEXT =
  "Founded in 2014 in Springfield, Northwind Widgets manufactures industrial widget-sorting machines for manufacturing plants. The company employs 85 people, serves clients in 12 countries, and offers the WidgetSorter 3000 as its flagship product.";

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
  console.log("Calling the real generateQuestionsForCategory('company-fit') with an instrumented LLMCaller...\n");
  console.log(`Company context supplied: "${COMPANY_CONTEXT}"\n`);

  const start = Date.now();
  const questions = await generateQuestionsForCategory(
    { category: "company-fit", requirements: REQUIREMENTS, companyContext: COMPANY_CONTEXT, roleContext: ROLE_CONTEXT },
    spyCall,
    1
  );
  const elapsedMs = Date.now() - start;

  console.log(`Elapsed: ${elapsedMs}ms\n`);
  console.log("=== Captured StepResult ===");
  console.log(JSON.stringify(captured, null, 2));

  console.log("\n=== generateQuestionsForCategory's actual returned Question[] ===");
  console.log(JSON.stringify(questions, null, 2));

  console.log("\n=== Cross-check: requirement_ids (none supplied, so any non-empty would be unexpected) ===");
  for (const q of questions) {
    console.log(`${q.id}: requirement_ids=${JSON.stringify(q.requirement_ids)}`);
  }
  console.log(`\nTotal questions generated: ${questions.length}`);
}

main().catch((err) => {
  console.error("Company-fit question generation test threw an unexpected error:", err);
  process.exitCode = 1;
});

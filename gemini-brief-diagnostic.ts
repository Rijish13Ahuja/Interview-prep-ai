// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Calls the REAL, unmodified generateCompanyBrief() with a "spy" LLMCaller that captures
// the full StepResult (ok/attempts/reason/message) generateCompanyBrief itself discards.
// No production code is modified; the prompt/logic used is exactly generateCompanyBrief's own.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createGeminiTransport,
  createLLMCaller,
  generateCompanyBrief,
  type CrawledPage,
  type LLMCaller,
  type StepResult,
} from "@trao/core";
import type { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, ".env") });

const COMPANY_NAME = "Northwind Widgets";
const SYNTHETIC_PAGES: CrawledPage[] = [
  {
    url: "https://example-fake-northwind-widgets.test/about",
    text: `Northwind Widgets was founded in 2014 and is headquartered in Springfield. The company builds
industrial widget-sorting machines for manufacturing plants. Northwind Widgets has 85 employees and
serves customers in 12 countries. The company's flagship product is the WidgetSorter 3000, released
in 2019.`,
  },
];

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
  console.log("Calling the real generateCompanyBrief() with an instrumented LLMCaller...\n");

  const start = Date.now();
  const briefResult = await generateCompanyBrief(COMPANY_NAME, SYNTHETIC_PAGES, spyCall);
  const elapsedMs = Date.now() - start;

  console.log(`Elapsed: ${elapsedMs}ms\n`);
  console.log("=== Captured StepResult (normally discarded by generateCompanyBrief) ===");
  console.log(JSON.stringify(captured, null, 2));
  console.log("\n=== generateCompanyBrief's actual returned CompanyBriefResult ===");
  console.log(JSON.stringify(briefResult, null, 2));
}

main().catch((err) => {
  console.error("Diagnostic threw an unexpected error:", err);
  process.exitCode = 1;
});

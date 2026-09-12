// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Calls the REAL, unmodified generateKit() orchestrator with:
//  - a real LLMCaller (createGeminiTransport, unmodified config)
//  - an injected (controlled, synthetic) crawl function — avoids unrelated real-network
//    variability while still exercising the real orchestrator's consumption of crawl output,
//    exactly as CrawlFn's own injection point is designed for (see orchestrator.ts comment)
//  - discussionSearch: null, matching this environment's actual real resolution (no
//    GOOGLE_CSE_API_KEY/CX configured) — not a shortcut, this is what production would do too
//  - crawlOptions.allowLoopback: false, matching the live API's real hardcoded behavior
// Per-stage Gemini attempt visibility is built by combining the REAL onStep hook (an
// existing PipelineDeps extension point) with a spy on `call` — no production code touched.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createGeminiTransport,
  createLLMCaller,
  generateKit,
  KitSchema,
  type CrawlFn,
  type GenerationStep,
  type LLMCaller,
  type PipelineDeps,
  type StepResult,
} from "@trao/core";
import type { z } from "zod";

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

const COMPANY_URL = "https://northwind-widgets.example/careers";
const DAYS = 5;

// Controlled, synthetic crawl result — same Northwind Widgets content used in the earlier
// isolated Company Brief tests, so the 200-char gate is genuinely exceeded and the real
// brief-generation LLM call is actually exercised, not skipped.
const injectedCrawl: CrawlFn = async () => ({
  pagesUsed: [
    {
      url: COMPANY_URL,
      text: `Northwind Widgets was founded in 2014 and is headquartered in Springfield. The company builds
industrial widget-sorting machines for manufacturing plants. Northwind Widgets has 85 employees and
serves customers in 12 countries. The company's flagship product is the WidgetSorter 3000, released
in 2019.`,
    },
  ],
  skipped: [],
});

interface CallLogEntry {
  step: GenerationStep | "unknown";
  attempts?: number;
  ok: boolean;
  reason?: string;
  message?: string;
}

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

  let currentStep: GenerationStep | "unknown" = "unknown";
  const callLog: CallLogEntry[] = [];

  const spyCall: LLMCaller = async <T>(prompt: string, schema: z.ZodType<T>) => {
    const result = await realCall(prompt, schema);
    const r = result as StepResult<unknown>;
    callLog.push(
      r.ok
        ? { step: currentStep, ok: true, attempts: r.attempts }
        : { step: currentStep, ok: false, attempts: r.attempts, reason: r.reason, message: r.message }
    );
    return result;
  };

  const deps: PipelineDeps = {
    call: spyCall,
    discussionSearch: null, // matches this environment's real resolution — no CSE credentials configured
    crawl: injectedCrawl,
    crawlOptions: { allowLoopback: false },
    onStep: (step) => {
      currentStep = step;
      console.log(`[onStep] ${step}`);
    },
  };

  console.log(`Model: ${process.env.GEMINI_MODEL?.trim() || "(default) gemini-3.8-flash"}`);
  console.log("Calling the real generateKit() — ONE logical full-pipeline invocation...\n");

  const start = Date.now();
  const result = await generateKit({ jd: JD, company_url: COMPANY_URL, days: DAYS }, deps);
  const elapsedMs = Date.now() - start;

  console.log(`\nElapsed: ${elapsedMs}ms`);
  console.log(`\n=== Per-call log (step -> outcome), in chronological order ===`);
  for (const entry of callLog) {
    console.log(JSON.stringify(entry));
  }

  console.log(`\n=== generateKit() result.status: ${result.status} ===`);
  if (result.status === "failed") {
    console.log("error:", JSON.stringify(result.error, null, 2));
    return;
  }

  const kit = result.kit;

  // Independent re-check: prove the returned kit actually satisfies KitSchema right now,
  // not just trust that orchestrator.ts's internal check passed.
  const reValidated = KitSchema.safeParse(kit);
  console.log(`\nIndependent KitSchema re-validation of the returned kit: ${reValidated.success ? "PASSED" : "FAILED"}`);
  if (!reValidated.success) {
    console.log(reValidated.error.issues);
  }

  console.log("\n=== FULL KIT ===");
  console.log(JSON.stringify(kit, null, 2));
}

main().catch((err) => {
  console.error("Full pipeline test threw an unexpected error:", err);
  process.exitCode = 1;
});

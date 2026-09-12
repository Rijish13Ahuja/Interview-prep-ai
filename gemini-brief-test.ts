// Temporary, standalone diagnostic script — not part of the pipeline, not committed.
// Exercises the REAL, unmodified generateCompanyBrief() production function against a
// real Gemini call. No crawling, no MongoDB, no Google CSE — synthetic page input only.
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createGeminiTransport, createLLMCaller, generateCompanyBrief, type CrawledPage } from "@trao/core";

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

  const totalChars = SYNTHETIC_PAGES.reduce((sum, p) => sum + p.text.length, 0);
  console.log(`Synthetic source length: ${totalChars} chars (gate is 200 — ${totalChars > 200 ? "above" : "BELOW, fallback will trigger"})`);

  const transport = createGeminiTransport({
    apiKey,
    model: process.env.GEMINI_MODEL,
    baseUrl: process.env.GEMINI_BASE_URL,
  });
  const call = createLLMCaller(transport);

  console.log(`Model: ${process.env.GEMINI_MODEL?.trim() || "(default) gemini-3.8-flash"}`);
  console.log("Calling the real generateCompanyBrief()...\n");

  const start = Date.now();
  const result = await generateCompanyBrief(COMPANY_NAME, SYNTHETIC_PAGES, call);
  const elapsedMs = Date.now() - start;

  console.log(`Elapsed: ${elapsedMs}ms`);
  console.log("RESULT:");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Brief test threw an unexpected error:", err);
  process.exitCode = 1;
});

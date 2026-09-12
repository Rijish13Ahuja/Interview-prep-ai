import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGeminiTransport, createLLMCaller } from "../src/llm/provider.js";
import { crawlCompanySite } from "../src/crawler/crawler.js";
import { generateKit, type PipelineDeps } from "../src/pipeline/orchestrator.js";
import { runBatch } from "../src/pipeline/batchRunner.js";
import type { BatchCase } from "../src/schema/batch.js";

/**
 * End-to-end integration test against real local HTTP servers — no mocking
 * at the fetch/network layer. This is the closest we can get, without a
 * real Gemini API key, to proving the exact scenario Appendix B describes:
 * a batch case whose company_url is a local server (`http://localhost:PORT/...`),
 * exercised through the real SSRF guard's ALLOW_LOOPBACK_URLS exception, the
 * real crawler, and the real Gemini-shaped HTTP transport (retry/repair
 * logic included) — everything except the actual third-party LLM vendor.
 */

const JD = `Senior Backend Engineer at Acme.

5+ years of experience with Node.js is required.
Must be comfortable mentoring junior engineers.

Nice to have: experience with GraphQL.`;

function jsonResponse(payload: unknown) {
  return JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] });
}

function extractRequirementIdsFromPrompt(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]))];
}

let companyServer: Server;
let companyBaseUrl: string;
let geminiServer: Server;
let geminiBaseUrl: string;

beforeAll(async () => {
  companyServer = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nAllow: /\n");
      return;
    }
    if (req.url === "/" || req.url === "") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><h1>Acme</h1><nav>
        <a href="/careers">Careers</a>
        <a href="/pricing">Pricing</a>
      </nav></body></html>`);
      return;
    }
    if (req.url === "/careers") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><h1>Careers at Acme</h1>
        <p>${"We are hiring engineers who love shipping reliable software. ".repeat(6)}</p>
        <p>Our interview process includes a take-home assignment followed by a system design round.</p>
      </body></html>`);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => companyServer.listen(0, "127.0.0.1", resolve));
  const companyAddr = companyServer.address();
  if (typeof companyAddr !== "object" || companyAddr === null) throw new Error("failed to bind company server");
  companyBaseUrl = `http://127.0.0.1:${companyAddr.port}/`;

  geminiServer = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const prompt: string = parsed.contents[0].parts[0].text;
        res.writeHead(200, { "content-type": "application/json" });

        if (prompt.includes("RULES:")) {
          res.end(
            jsonResponse({
              title: "Senior Backend Engineer",
              seniority: "Senior",
              location: "Remote",
              responsibilities: ["Build and maintain backend services"],
              requirements: [
                { text: "5+ years Node.js", kind: "technical", priority: "must", evidence: "5+ years of experience with Node.js is required" },
                { text: "Mentor junior engineers", kind: "behavioural", priority: "must", evidence: "Must be comfortable mentoring junior engineers" },
                { text: "GraphQL experience", kind: "technical", priority: "nice", evidence: "Nice to have: experience with GraphQL." },
              ],
            })
          );
          return;
        }
        if (prompt.includes("REQUIREMENTS TO RE-CHECK")) {
          res.end(jsonResponse({ requirements: [] }));
          return;
        }
        if (prompt.includes("Summarize what the company")) {
          res.end(jsonResponse({ summary: "Acme builds reliable backend software.", what_they_do: "Backend infrastructure SaaS." }));
          return;
        }
        if (prompt.includes('for the "')) {
          const categoryMatch = prompt.match(/for the "([a-z-]+)" category/);
          const category = categoryMatch ? categoryMatch[1] : "unknown";
          const reqIds = extractRequirementIdsFromPrompt(prompt);
          res.end(
            jsonResponse({
              questions: [{ requirement_ids: reqIds, prompt: `${category} question about the role`, answer_outline: "A solid outline.", difficulty: 2 }],
            })
          );
          return;
        }
        if (prompt.includes("Create concise study flashcards")) {
          const reqIds = extractRequirementIdsFromPrompt(prompt);
          res.end(jsonResponse({ flashcards: reqIds.map((id, i) => ({ front: `Front ${i}`, back: `Back ${i}`, requirement_ids: [id] })) }));
          return;
        }

        res.writeHead(500);
        res.end(jsonResponse({ error: "unexpected prompt" }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: String(err) }));
      }
    });
  });
  await new Promise<void>((resolve) => geminiServer.listen(0, "127.0.0.1", resolve));
  const geminiAddr = geminiServer.address();
  if (typeof geminiAddr !== "object" || geminiAddr === null) throw new Error("failed to bind gemini mock server");
  geminiBaseUrl = `http://127.0.0.1:${geminiAddr.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => companyServer.close(resolve));
  await new Promise((resolve) => geminiServer.close(resolve));
});

describe("end-to-end against real local HTTP servers (no real Gemini key required)", () => {
  it("crawls a local company server only when ALLOW_LOOPBACK_URLS-equivalent is enabled", async () => {
    const blocked = await crawlCompanySite(companyBaseUrl, { allowLoopback: false });
    expect(blocked.pagesUsed).toEqual([]);

    const allowed = await crawlCompanySite(companyBaseUrl, { allowLoopback: true });
    expect(allowed.pagesUsed.length).toBeGreaterThan(0);
    expect(allowed.pagesUsed.some((p) => p.url.includes("/careers"))).toBe(true);
  });

  it("the real Gemini-shaped HTTP transport round-trips through generateStructured", async () => {
    const transport = createGeminiTransport({ apiKey: "test-key", baseUrl: geminiBaseUrl });
    const call = createLLMCaller(transport);
    const result = await call(
      "Summarize what the company does.\nRULES:\nreturn JSON",
      // reuse the real extraction schema indirectly isn't needed — a minimal ad hoc schema is enough here
      (await import("../src/pipeline/extractRequirements.js")).InitialExtractionResponseSchema
    );
    expect(result.ok).toBe(true);
  });

  it("runs the full generateKit pipeline end-to-end against real HTTP servers and produces a valid, fully-covered kit", async () => {
    const transport = createGeminiTransport({ apiKey: "test-key", baseUrl: geminiBaseUrl });
    const deps: PipelineDeps = {
      call: createLLMCaller(transport),
      discussionSearch: null,
      crawl: crawlCompanySite,
      crawlOptions: { allowLoopback: true },
    };

    const result = await generateKit({ jd: JD, company_url: companyBaseUrl, days: 5 }, deps);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.kit.role.requirements.length).toBe(3);
    expect(result.kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(result.kit.source.pages_used.some((u) => u.includes("/careers"))).toBe(true);
    expect(result.kit.company_brief.sources.length).toBeGreaterThan(0);
    expect(result.kit.schedule.days).toHaveLength(5);
  }, 20000);

  it("runs the batch runner (the same function scripts/evaluate.ts calls) against real HTTP servers", async () => {
    const transport = createGeminiTransport({ apiKey: "test-key", baseUrl: geminiBaseUrl });
    const deps: PipelineDeps = {
      call: createLLMCaller(transport),
      discussionSearch: null,
      crawl: crawlCompanySite,
      crawlOptions: { allowLoopback: true },
    };

    const cases: BatchCase[] = [
      { id: "case-01", jd: JD, company_url: companyBaseUrl, days: 5 },
      { id: "case-02", jd: JD, company_url: "http://127.0.0.1:1/unreachable-port", days: 3 },
    ];

    const output = await runBatch(cases, deps);
    expect(output.kits).toHaveLength(2);
    const ok = output.kits.find((k) => k.id === "case-01")!;
    expect(ok.status).toBe("ok");

    // an unreachable company site degrades the crawl only — extraction/questions still run — so this case
    // is still "ok" per the finalized failure taxonomy (a missing company page is a partial failure, not fatal)
    const degraded = output.kits.find((k) => k.id === "case-02")!;
    expect(degraded.status).toBe("ok");
    expect((degraded.kit as any).source.pages_used).toEqual([]);
  }, 30000);
});

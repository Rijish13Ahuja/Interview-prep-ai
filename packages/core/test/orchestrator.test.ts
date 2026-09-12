import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { LLMCaller, StepResult } from "../src/llm/provider.js";
import { InitialExtractionResponseSchema, EvidenceRepairResponseSchema } from "../src/pipeline/extractRequirements.js";
import { BriefResponseSchema } from "../src/pipeline/companyBrief.js";
import { QuestionsResponseSchema } from "../src/pipeline/questions.js";
import { FlashcardsResponseSchema } from "../src/pipeline/flashcards.js";
import { generateKit, type CrawlFn, type PipelineDeps } from "../src/pipeline/orchestrator.js";

const JD = "Backend Engineer. 5+ years of Node.js experience is required. Must be able to mentor junior engineers.";

interface FakeCallerOptions {
  initialData?: Partial<z.infer<typeof InitialExtractionResponseSchema>>;
  briefData?: z.infer<typeof BriefResponseSchema>;
  failFirstCallForCategory?: string; // simulates one category's initial call exhausting its retry budget
  extractionFails?: boolean;
}

function extractRequirementIdsFromPrompt(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]))];
}

function makeFakeCaller(opts: FakeCallerOptions = {}): LLMCaller {
  const callCounts = new Map<string, number>();

  return (async (prompt: string, schema: z.ZodTypeAny): Promise<StepResult<unknown>> => {
    if (schema === InitialExtractionResponseSchema) {
      if (opts.extractionFails) {
        return { ok: false, attempts: 3, reason: "transport", message: "simulated total failure" };
      }
      return {
        ok: true,
        attempts: 1,
        data: schema.parse({
          title: "Backend Engineer",
          seniority: "Senior",
          location: "Remote",
          responsibilities: ["Build APIs"],
          requirements: [
            { text: "5+ years Node.js", kind: "technical", priority: "must", evidence: "5+ years of Node.js experience is required" },
            { text: "Mentor junior engineers", kind: "behavioural", priority: "must", evidence: "Must be able to mentor junior engineers" },
          ],
          ...opts.initialData,
        }),
      };
    }

    if (schema === EvidenceRepairResponseSchema) {
      return { ok: true, attempts: 1, data: schema.parse({ requirements: [] }) };
    }

    if (schema === BriefResponseSchema) {
      return {
        ok: true,
        attempts: 1,
        data: schema.parse(opts.briefData ?? { summary: "Acme builds widgets.", what_they_do: "Widget SaaS." }),
      };
    }

    if (schema === QuestionsResponseSchema) {
      const categoryMatch = prompt.match(/for the "([a-z-]+)" category/);
      const category = categoryMatch ? categoryMatch[1] : "unknown";
      const count = (callCounts.get(category) ?? 0) + 1;
      callCounts.set(category, count);

      if (opts.failFirstCallForCategory === category && count === 1) {
        return { ok: false, attempts: 3, reason: "transport", message: `simulated failure for ${category}` };
      }

      const reqIds = extractRequirementIdsFromPrompt(prompt);
      return {
        ok: true,
        attempts: 1,
        data: schema.parse({ questions: [{ requirement_ids: reqIds, prompt: `Question for ${category}`, answer_outline: "Outline", difficulty: 2 }] }),
      };
    }

    if (schema === FlashcardsResponseSchema) {
      return { ok: true, attempts: 1, data: schema.parse({ flashcards: [] }) };
    }

    throw new Error(`Unexpected schema passed to fake caller. Prompt started: ${prompt.slice(0, 80)}`);
  }) as LLMCaller;
}

const emptyCrawl: CrawlFn = async () => ({ pagesUsed: [], skipped: [] });

function baseDeps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    call: makeFakeCaller(),
    discussionSearch: null,
    crawl: emptyCrawl,
    crawlOptions: { allowLoopback: false },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("generateKit — orchestrator", () => {
  it("happy path: produces a valid kit with full coverage on the first pass", async () => {
    const result = await generateKit({ jd: JD, company_url: "https://acme.example", days: 5 }, baseDeps());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.kit.role.requirements).toHaveLength(2);
    expect(result.kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(result.kit.coverage.passes).toBe(1);
    expect(result.kit.schedule.days).toHaveLength(5);
    expect(result.kit.questions.length).toBeGreaterThan(0);
  });

  it("gap-fill: a category that fails its first pass leaves a gap that the one extra pass closes", async () => {
    const call = makeFakeCaller({ failFirstCallForCategory: "behavioural" });
    const result = await generateKit({ jd: JD, company_url: "https://acme.example", days: 3 }, baseDeps({ call }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.kit.coverage.passes).toBe(2);
    expect(result.kit.coverage.uncovered_requirement_ids).toEqual([]);
    // the behavioural-linked requirement must still end up covered after the gap-fill pass
    const behaviouralReq = result.kit.role.requirements.find((r) => r.kind === "behavioural")!;
    const coveredByGapFill = result.kit.questions.some((q) => q.requirement_ids.includes(behaviouralReq.id));
    expect(coveredByGapFill).toBe(true);
  });

  it("is fatal only when requirement extraction itself fails", async () => {
    const call = makeFakeCaller({ extractionFails: true });
    const result = await generateKit({ jd: JD, company_url: "https://acme.example", days: 5 }, baseDeps({ call }));
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.error.code).toBe("EXTRACTION_FAILED");
  });

  it("a thin JD producing zero requirements still yields a valid, honest, non-fatal kit", async () => {
    const call = makeFakeCaller({ initialData: { requirements: [] } });
    const result = await generateKit({ jd: "We need a developer.", company_url: "https://acme.example", days: 4 }, baseDeps({ call }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.kit.role.requirements).toHaveLength(0);
    expect(result.kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(result.kit.schedule.days).toHaveLength(4);
  });

  it("company brief degrades honestly when crawled content is too thin, without ever calling the brief LLM", async () => {
    const thinCrawl: CrawlFn = async () => ({ pagesUsed: [{ url: "https://acme.example/", text: "short" }], skipped: [] });
    let briefCallMade = false;
    const call: LLMCaller = (async (prompt: string, schema: z.ZodTypeAny) => {
      if (schema === BriefResponseSchema) briefCallMade = true;
      return makeFakeCaller()(prompt, schema);
    }) as LLMCaller;

    const result = await generateKit({ jd: JD, company_url: "https://acme.example", days: 5 }, baseDeps({ call, crawl: thinCrawl }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(briefCallMade).toBe(false);
    expect(result.kit.company_brief.summary).toContain("Limited company information");
    expect(result.kit.company_brief.sources).toEqual([]);
    // source.pages_used still honestly reflects what WAS retrieved, independent of the brief's own gate
    expect(result.kit.source.pages_used).toEqual(["https://acme.example/"]);
  });

  it("never claims discussion was 'found nothing' when search was never configured", async () => {
    const result = await generateKit({ jd: JD, company_url: "https://acme.example", days: 5 }, baseDeps({ discussionSearch: null }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.kit.company_brief.discussion_status).toBe("not_configured");
    expect(result.kit.company_brief.summary).not.toMatch(/no public discussion/i);
  });

  it("honestly reports 'no results' distinctly from 'not configured' when a search actually ran and found nothing", async () => {
    const noResultsSearch = { search: async () => [] };
    const result = await generateKit({ jd: JD, company_url: "https://acme.example", days: 5 }, baseDeps({ discussionSearch: noResultsSearch }));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.kit.company_brief.discussion_status).toBe("no_results");
    expect(result.kit.company_brief.summary).toMatch(/no public discussion/i);
  });

  it("rejects invalid input deterministically before any LLM call", async () => {
    const result = await generateKit({ jd: "", company_url: "https://acme.example", days: 5 }, baseDeps());
    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.error.code).toBe("INVALID_INPUT");
  });
});

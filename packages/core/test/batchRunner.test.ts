import { describe, expect, it } from "vitest";
import type { BatchCase } from "../src/schema/batch.js";
import { runBatch } from "../src/pipeline/batchRunner.js";
import type { GenerateKitInput, GenerateKitResult, PipelineDeps } from "../src/pipeline/orchestrator.js";
import type { Kit } from "../src/schema/kit.js";

function minimalKit(overrides: Partial<Kit> = {}): Kit {
  return {
    source: { company: "Acme", company_url: "https://acme.example", role: "Engineer", location: "", jd_chars: 10, researched_at: "2026-01-01T00:00:00.000Z", pages_used: [] },
    company_brief: { summary: "s", what_they_do: "w", sources: [], discussion_status: "not_configured" },
    role: { title: "Engineer", seniority: "Mid", responsibilities: [], requirements: [] },
    questions: [],
    flashcards: [],
    schedule: { days_available: 1, days: [{ day: 1, focus: "Full review — all topics", question_ids: [], minutes: 5 }] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
    ...overrides,
  };
}

const cases: BatchCase[] = [
  { id: "case-01", jd: "JD one", company_url: "http://localhost:1/acme", days: 5 },
  { id: "case-02", jd: "JD two", company_url: "http://localhost:1/broken", days: 3 },
  { id: "case-03", jd: "JD three", company_url: "http://localhost:1/throws", days: 1 },
];

function fakeDeps(): PipelineDeps {
  return { call: (async () => ({ ok: false, attempts: 3, reason: "transport", message: "unused" })) as any, discussionSearch: null, crawl: async () => ({ pagesUsed: [], skipped: [] }), crawlOptions: { allowLoopback: false } };
}

async function fakeGenerate(input: GenerateKitInput): Promise<GenerateKitResult> {
  if (input.jd === "JD one") return { status: "ok", kit: minimalKit() };
  if (input.jd === "JD two") return { status: "failed", error: { code: "COMPANY_UNREACHABLE", message: "Company site unreachable after 3 retries." } };
  throw new Error("boom — unexpected thrown error, not a returned failure");
}

describe("runBatch", () => {
  it("produces exactly one output entry per input case, in order, regardless of per-case outcome", async () => {
    const output = await runBatch(cases, fakeDeps(), fakeGenerate);
    expect(output.kits).toHaveLength(3);
    expect(output.kits.map((k) => k.id)).toEqual(["case-01", "case-02", "case-03"]);
  });

  it("matches the exact Appendix B envelope shape", async () => {
    const output = await runBatch(cases, fakeDeps(), fakeGenerate);
    expect(output.version).toBe("1.0");
    expect(typeof output.generated_at).toBe("string");
    expect(Array.isArray(output.kits)).toBe(true);
  });

  it("marks a successful case 'ok' with a kit and a null error", async () => {
    const output = await runBatch(cases, fakeDeps(), fakeGenerate);
    const ok = output.kits.find((k) => k.id === "case-01")!;
    expect(ok.status).toBe("ok");
    expect(ok.error).toBeNull();
    expect(ok.kit).not.toBeNull();
  });

  it("marks a returned pipeline failure 'failed' with the structured error and a null kit", async () => {
    const output = await runBatch(cases, fakeDeps(), fakeGenerate);
    const failed = output.kits.find((k) => k.id === "case-02")!;
    expect(failed.status).toBe("failed");
    expect(failed.kit).toBeNull();
    expect(failed.error).toEqual({ code: "COMPANY_UNREACHABLE", message: "Company site unreachable after 3 retries." });
  });

  it("isolates an unexpected thrown error to its own case instead of aborting the run", async () => {
    const output = await runBatch(cases, fakeDeps(), fakeGenerate);
    const thrown = output.kits.find((k) => k.id === "case-03")!;
    expect(thrown.status).toBe("failed");
    expect(thrown.error?.code).toBe("UNEXPECTED_ERROR");
    // and case-01 (processed before the throwing case) still succeeded — the run wasn't aborted
    expect(output.kits.find((k) => k.id === "case-01")!.status).toBe("ok");
  });

  it("strips builder-only origin/isLocked fields from the kit written to batch output", async () => {
    const kitWithBuilderState = minimalKit({
      questions: [{ id: "q1", requirement_ids: [], category: "technical", prompt: "p", answer_outline: "a", difficulty: 1, origin: "ai", isLocked: false }],
    });
    const generate = async (): Promise<GenerateKitResult> => ({ status: "ok", kit: kitWithBuilderState });
    const output = await runBatch([cases[0]], fakeDeps(), generate);
    const question = (output.kits[0].kit as any).questions[0];
    expect(question).not.toHaveProperty("origin");
    expect(question).not.toHaveProperty("isLocked");
  });

  it("handles an empty case list without error", async () => {
    const output = await runBatch([], fakeDeps(), fakeGenerate);
    expect(output.kits).toEqual([]);
  });
});

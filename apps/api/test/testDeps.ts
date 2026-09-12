import type { z } from "zod";
import {
  InitialExtractionResponseSchema,
  EvidenceRepairResponseSchema,
  BriefResponseSchema,
  QuestionsResponseSchema,
  FlashcardsResponseSchema,
  type LLMCaller,
  type StepResult,
  type PipelineDeps,
  type CrawlFn,
} from "@trao/core";

export const JD =
  "Senior Backend Engineer. 5+ years of Node.js experience is required. Must be comfortable mentoring junior engineers. Nice to have: GraphQL experience.";

function extractRequirementIdsFromPrompt(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(/\[(r\d+)\]/g)].map((m) => m[1]))];
}

export function makeFakeCaller(): LLMCaller {
  const callCounts = new Map<string, number>();

  return (async (prompt: string, schema: z.ZodTypeAny): Promise<StepResult<unknown>> => {
    if (schema === InitialExtractionResponseSchema) {
      return {
        ok: true,
        attempts: 1,
        data: schema.parse({
          title: "Senior Backend Engineer",
          seniority: "Senior",
          location: "Remote",
          responsibilities: ["Build APIs"],
          requirements: [
            { text: "5+ years Node.js", kind: "technical", priority: "must", evidence: "5+ years of Node.js experience is required" },
            { text: "Mentor juniors", kind: "behavioural", priority: "must", evidence: "Must be comfortable mentoring junior engineers" },
            { text: "GraphQL", kind: "technical", priority: "nice", evidence: "Nice to have: GraphQL experience" },
          ],
        }),
      };
    }
    if (schema === EvidenceRepairResponseSchema) {
      return { ok: true, attempts: 1, data: schema.parse({ requirements: [] }) };
    }
    if (schema === BriefResponseSchema) {
      return { ok: true, attempts: 1, data: schema.parse({ summary: "Acme builds widgets.", what_they_do: "Widget SaaS." }) };
    }
    if (schema === QuestionsResponseSchema) {
      const categoryMatch = prompt.match(/for the "([a-z-]+)" category/);
      const category = categoryMatch ? categoryMatch[1] : "unknown";
      const count = (callCounts.get(category) ?? 0) + 1;
      callCounts.set(category, count);
      const reqIds = extractRequirementIdsFromPrompt(prompt);
      return {
        ok: true,
        attempts: 1,
        data: schema.parse({
          questions: [{ requirement_ids: reqIds, prompt: `${category} question #${count}`, answer_outline: "Outline", difficulty: 2 }],
        }),
      };
    }
    if (schema === FlashcardsResponseSchema) {
      const reqIds = extractRequirementIdsFromPrompt(prompt);
      return { ok: true, attempts: 1, data: schema.parse({ flashcards: reqIds.map((id, i) => ({ front: `F${i}`, back: `B${i}`, requirement_ids: [id] })) }) };
    }
    throw new Error(`Unexpected schema in fake caller. Prompt: ${prompt.slice(0, 100)}`);
  }) as LLMCaller;
}

export const emptyCrawl: CrawlFn = async () => ({ pagesUsed: [], skipped: [] });

export function buildFakePipelineDeps(): PipelineDeps {
  return {
    call: makeFakeCaller(),
    discussionSearch: null,
    crawl: emptyCrawl,
    crawlOptions: { allowLoopback: false },
  };
}

/** Deliberately slow (artificial delay on every call) so tests can reliably observe the "generating" state. */
export function buildSlowFakePipelineDeps(delayMs = 200): PipelineDeps {
  const fast = makeFakeCaller();
  const slow: LLMCaller = (async (prompt: string, schema: z.ZodTypeAny) => {
    await new Promise((r) => setTimeout(r, delayMs));
    return fast(prompt, schema);
  }) as LLMCaller;

  return { call: slow, discussionSearch: null, crawl: emptyCrawl, crawlOptions: { allowLoopback: false } };
}

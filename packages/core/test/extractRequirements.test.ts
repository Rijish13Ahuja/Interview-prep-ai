import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { LLMCaller, StepResult } from "../src/llm/provider.js";
import {
  extractRequirements,
  EvidenceRepairResponseSchema,
  InitialExtractionResponseSchema,
} from "../src/pipeline/extractRequirements.js";

const JD = "Senior Backend Engineer. 5+ years of Node.js experience is required. Nice to have: GraphQL knowledge. You'll mentor junior engineers.";

function fakeCaller(responses: { schema: z.ZodTypeAny; data: unknown }[]): LLMCaller {
  return (async (_prompt: string, schema: z.ZodTypeAny): Promise<StepResult<unknown>> => {
    const match = responses.find((r) => r.schema === schema);
    if (!match) throw new Error("Unexpected schema passed to fake caller");
    return { ok: true, attempts: 1, data: schema.parse(match.data) };
  }) as LLMCaller;
}

describe("extractRequirements", () => {
  it("keeps requirements whose evidence is grounded in the JD", async () => {
    const call = fakeCaller([
      {
        schema: InitialExtractionResponseSchema,
        data: {
          title: "Senior Backend Engineer",
          seniority: "Senior",
          location: "Remote",
          responsibilities: ["Build APIs"],
          requirements: [
            { text: "5+ years Node.js", kind: "technical", priority: "must", evidence: "5+ years of Node.js experience is required" },
            { text: "GraphQL knowledge", kind: "technical", priority: "nice", evidence: "Nice to have: GraphQL knowledge" },
          ],
        },
      },
    ]);

    const outcome = await extractRequirements(JD, call);
    expect(outcome.fatal).toBe(false);
    expect(outcome.requirements).toHaveLength(2);
    expect(outcome.requirements[0].id).toBe("r1");
    expect(outcome.title).toBe("Senior Backend Engineer");
  });

  it("drops a requirement whose evidence cannot be grounded, even after the one repair attempt", async () => {
    const call = fakeCaller([
      {
        schema: InitialExtractionResponseSchema,
        data: {
          title: "Backend Engineer",
          seniority: "Mid",
          location: "",
          responsibilities: [],
          requirements: [{ text: "Kubernetes administration", kind: "technical", priority: "must", evidence: "10+ years of Kubernetes administration" }],
        },
      },
      {
        // repair attempt also fails to ground it — model omits it, per instructions
        schema: EvidenceRepairResponseSchema,
        data: { requirements: [] },
      },
    ]);

    const outcome = await extractRequirements(JD, call);
    expect(outcome.fatal).toBe(false);
    expect(outcome.requirements).toHaveLength(0);
  });

  it("recovers a requirement via the repair attempt when a corrected quote is grounded", async () => {
    const call = fakeCaller([
      {
        schema: InitialExtractionResponseSchema,
        data: {
          title: "Backend Engineer",
          seniority: "Mid",
          location: "",
          responsibilities: [],
          requirements: [{ text: "Node.js experience", kind: "technical", priority: "must", evidence: "totally fabricated quote not in JD" }],
        },
      },
      {
        schema: EvidenceRepairResponseSchema,
        data: { requirements: [{ text: "Node.js experience", kind: "technical", priority: "must", evidence: "5+ years of Node.js experience is required" }] },
      },
    ]);

    const outcome = await extractRequirements(JD, call);
    expect(outcome.requirements).toHaveLength(1);
    expect(outcome.requirements[0].evidence).toContain("5+ years of Node.js");
  });

  it("applies the must/nice contradiction override even when the LLM assigns the opposite", async () => {
    const call = fakeCaller([
      {
        schema: InitialExtractionResponseSchema,
        data: {
          title: "Backend Engineer",
          seniority: "Mid",
          location: "",
          responsibilities: [],
          requirements: [{ text: "GraphQL", kind: "technical", priority: "must", evidence: "Nice to have: GraphQL knowledge" }],
        },
      },
    ]);

    const outcome = await extractRequirements(JD, call);
    expect(outcome.requirements[0].priority).toBe("nice");
  });

  it("is fatal only when the extraction LLM call itself fails, not when zero requirements are grounded", async () => {
    const call: LLMCaller = (async () => ({ ok: false, attempts: 3, reason: "schema", message: "gave up" })) as LLMCaller;
    const outcome = await extractRequirements("hi", call);
    expect(outcome.fatal).toBe(true);
    expect(outcome.errorMessage).toContain("gave up");
  });

  it("treats a thin JD yielding zero requirements as a valid, non-fatal outcome", async () => {
    const call = fakeCaller([
      {
        schema: InitialExtractionResponseSchema,
        data: { title: "Developer", seniority: "unspecified", location: "", responsibilities: [], requirements: [] },
      },
    ]);
    const outcome = await extractRequirements("We need a developer.", call);
    expect(outcome.fatal).toBe(false);
    expect(outcome.requirements).toHaveLength(0);
  });
});

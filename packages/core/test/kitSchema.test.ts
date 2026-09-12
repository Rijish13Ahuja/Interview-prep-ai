import { describe, expect, it } from "vitest";
import { KitSchema, toAppendixAOutput, type Kit } from "../src/schema/kit.js";

function validKit(): Kit {
  return {
    source: {
      company: "Acme",
      company_url: "https://acme.example",
      role: "Backend Engineer",
      location: "Remote",
      jd_chars: 500,
      researched_at: new Date().toISOString(),
      pages_used: ["https://acme.example/careers"],
    },
    company_brief: {
      summary: "Acme builds widgets.",
      what_they_do: "Widget manufacturing SaaS.",
      sources: ["https://acme.example/careers"],
      discussion_status: "no_results",
    },
    role: {
      title: "Backend Engineer",
      seniority: "Senior",
      responsibilities: ["Build APIs"],
      requirements: [
        { id: "r1", text: "5+ years with Node.js", kind: "technical", priority: "must", evidence: "5+ years with Node.js" },
      ],
    },
    questions: [
      {
        id: "q1",
        requirement_ids: ["r1"],
        category: "technical",
        prompt: "Explain event loop internals.",
        answer_outline: "Covers phases, microtasks, macrotasks.",
        difficulty: 2,
        origin: "ai",
        isLocked: false,
      },
    ],
    flashcards: [
      { id: "f1", front: "What is the event loop?", back: "Node's mechanism for async I/O.", requirement_ids: ["r1"], origin: "ai", isLocked: false },
    ],
    schedule: {
      days_available: 1,
      days: [{ day: 1, focus: "Full review", question_ids: ["q1"], minutes: 25 }],
    },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

describe("KitSchema", () => {
  it("accepts a fully valid kit", () => {
    expect(() => KitSchema.parse(validKit())).not.toThrow();
  });

  it("rejects a non-integer difficulty", () => {
    const kit = validKit();
    kit.questions[0].difficulty = 2.5;
    expect(() => KitSchema.parse(kit)).toThrow();
  });

  it("rejects difficulty outside 1-3", () => {
    const kit = validKit();
    kit.questions[0].difficulty = 4;
    expect(() => KitSchema.parse(kit)).toThrow();
  });

  it("rejects non-integer minutes", () => {
    const kit = validKit();
    kit.schedule.days[0].minutes = 25.5;
    expect(() => KitSchema.parse(kit)).toThrow();
  });

  it("rejects a schedule whose days.length does not match days_available", () => {
    const kit = validKit();
    kit.schedule.days_available = 2;
    expect(() => KitSchema.parse(kit)).toThrow();
  });

  it("rejects a question referencing a non-existent requirement id", () => {
    const kit = validKit();
    kit.questions[0].requirement_ids = ["does-not-exist"];
    expect(() => KitSchema.parse(kit)).toThrow();
  });

  it("rejects a schedule day referencing a non-existent question id", () => {
    const kit = validKit();
    kit.schedule.days[0].question_ids = ["does-not-exist"];
    expect(() => KitSchema.parse(kit)).toThrow();
  });

  it("rejects duplicate requirement ids", () => {
    const kit = validKit();
    kit.role.requirements.push({ ...kit.role.requirements[0] });
    expect(() => KitSchema.parse(kit)).toThrow();
  });

  it("toAppendixAOutput strips builder-only origin/isLocked fields", () => {
    const output = toAppendixAOutput(validKit());
    expect(output.questions[0]).not.toHaveProperty("origin");
    expect(output.questions[0]).not.toHaveProperty("isLocked");
    expect(output.flashcards[0]).not.toHaveProperty("origin");
    // core Appendix A fields must survive the strip
    expect(output.questions[0]).toHaveProperty("prompt");
  });
});

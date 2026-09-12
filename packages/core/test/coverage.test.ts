import { describe, expect, it } from "vitest";
import { computeCoverage } from "../src/deterministic/coverage.js";
import type { Question, Requirement } from "../src/schema/kit.js";

function req(id: string, priority: "must" | "nice"): Requirement {
  return { id, text: `req ${id}`, kind: "technical", priority, evidence: `evidence ${id}` };
}

function q(id: string, requirement_ids: string[]): Question {
  return {
    id,
    requirement_ids,
    category: "technical",
    prompt: "p",
    answer_outline: "a",
    difficulty: 2,
    origin: "ai",
    isLocked: false,
  };
}

describe("computeCoverage", () => {
  it("reports no gaps when every must-have is covered", () => {
    const requirements = [req("r1", "must"), req("r2", "must")];
    const questions = [q("q1", ["r1"]), q("q2", ["r2"])];
    const result = computeCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toEqual([]);
  });

  it("reports must-have gaps that have no linked question", () => {
    const requirements = [req("r1", "must"), req("r2", "must")];
    const questions = [q("q1", ["r1"])];
    const result = computeCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toEqual(["r2"]);
  });

  it("never reports a nice-have requirement as uncovered", () => {
    const requirements = [req("r1", "nice")];
    const questions: Question[] = [];
    const result = computeCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toEqual([]);
  });

  it("does not double count when multiple questions cover the same requirement", () => {
    const requirements = [req("r1", "must")];
    const questions = [q("q1", ["r1"]), q("q2", ["r1"])];
    const result = computeCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toEqual([]);
    expect(result.coveredRequirementIds).toEqual(["r1"]);
  });

  it("treats a single question covering multiple requirements as covering all of them", () => {
    const requirements = [req("r1", "must"), req("r2", "must")];
    const questions = [q("q1", ["r1", "r2"])];
    const result = computeCoverage(requirements, questions);
    expect(result.uncoveredRequirementIds).toEqual([]);
  });

  it("handles no questions at all — every must-have is a gap", () => {
    const requirements = [req("r1", "must"), req("r2", "nice")];
    const result = computeCoverage(requirements, []);
    expect(result.uncoveredRequirementIds).toEqual(["r1"]);
  });
});

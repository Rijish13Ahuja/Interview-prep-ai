import { describe, expect, it } from "vitest";
import { isEvidenceGrounded, resolveContradictedPriority } from "../src/deterministic/requirementValidation.js";

describe("isEvidenceGrounded", () => {
  const jd = "We need someone with 5+ years of React experience. Nice to have: GraphQL knowledge.";

  it("matches an exact substring", () => {
    expect(isEvidenceGrounded("5+ years of React experience", jd)).toBe(true);
  });

  it("matches despite punctuation/case differences", () => {
    expect(isEvidenceGrounded("5+ YEARS OF REACT EXPERIENCE!!", jd)).toBe(true);
  });

  it("matches a lightly paraphrased quote via token overlap", () => {
    expect(isEvidenceGrounded("5+ years React experience needed", jd)).toBe(true);
  });

  it("rejects a fabricated requirement not present in the JD", () => {
    expect(isEvidenceGrounded("10+ years of Kubernetes administration", jd)).toBe(false);
  });

  it("rejects empty evidence", () => {
    expect(isEvidenceGrounded("", jd)).toBe(false);
  });
});

describe("resolveContradictedPriority", () => {
  it("flips must to nice when evidence explicitly says nice-to-have", () => {
    expect(resolveContradictedPriority("Nice to have: GraphQL knowledge", "must")).toBe("nice");
  });

  it("flips nice to must when evidence explicitly says required", () => {
    expect(resolveContradictedPriority("5+ years of React experience is required", "nice")).toBe("must");
  });

  it("leaves ambiguous language (no explicit signal) to the LLM's original judgment", () => {
    expect(resolveContradictedPriority("You'll need to communicate effectively with stakeholders", "must")).toBe("must");
    expect(resolveContradictedPriority("Experience mentoring junior engineers", "nice")).toBe("nice");
  });

  it("does not flip when both signals or neither signal are present", () => {
    expect(resolveContradictedPriority("Bonus points for required certifications", "must")).toBe("must");
  });
});

import type { Question, Requirement } from "../schema/kit.js";

export interface CoverageResult {
  uncoveredRequirementIds: string[];
  coveredRequirementIds: string[];
}

/**
 * Coverage is a pure set-difference: every must-have requirement id must be
 * referenced by at least one question. Nice-have requirements are never
 * reported as gaps — the brief only requires must-haves to be covered.
 */
export function computeCoverage(requirements: Requirement[], questions: Question[]): CoverageResult {
  const covered = new Set<string>();
  for (const q of questions) {
    for (const rid of q.requirement_ids) covered.add(rid);
  }

  const mustIds = requirements.filter((r) => r.priority === "must").map((r) => r.id);
  const uncoveredRequirementIds = mustIds.filter((id) => !covered.has(id));

  return { uncoveredRequirementIds, coveredRequirementIds: [...covered] };
}

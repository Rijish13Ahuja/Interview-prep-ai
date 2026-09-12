import type { Kit, Question, Requirement, Schedule } from "@trao/core";
import { computeCoverage } from "@trao/core";

export function nextIdAfter(existing: { id: string }[], prefix: string): string {
  const max = existing.reduce((m, item) => {
    const n = Number(item.id.replace(prefix, ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}

export function recomputeCoverage(kit: Kit): Kit["coverage"] {
  const result = computeCoverage(kit.role.requirements, kit.questions);
  return { uncovered_requirement_ids: result.uncoveredRequirementIds, passes: kit.coverage.passes };
}

/** Keeps schedule.days[].question_ids referentially valid after a question is removed. */
export function pruneScheduleReferences(schedule: Schedule, validQuestionIds: Set<string>): Schedule {
  return {
    ...schedule,
    days: schedule.days.map((day) => ({ ...day, question_ids: day.question_ids.filter((id) => validQuestionIds.has(id)) })),
  };
}

export function filterKnownRequirementIds(ids: string[], requirements: Requirement[]): string[] {
  const known = new Set(requirements.map((r) => r.id));
  return ids.filter((id) => known.has(id));
}

export function findQuestionIndex(kit: Kit, questionId: string): number {
  return kit.questions.findIndex((q) => q.id === questionId);
}

export function findFlashcardIndex(kit: Kit, flashcardId: string): number {
  return kit.flashcards.findIndex((f) => f.id === flashcardId);
}

export type QuestionEditableFields = Partial<Pick<Question, "prompt" | "answer_outline" | "category" | "difficulty" | "requirement_ids">>;

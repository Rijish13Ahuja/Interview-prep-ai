import type { Question, Requirement, ScheduleDay } from "../schema/kit.js";

const MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 15, 2: 25, 3: 40 };
const REVIEW_MINUTES_BY_DIFFICULTY: Record<number, number> = { 1: 8, 2: 12, 3: 18 };
const MAX_REVIEW_ITEMS_PER_DAY = 3;

export interface AllocateScheduleInput {
  requirements: Requirement[];
  questions: Question[];
  daysAvailable: number;
}

/**
 * Pure, deterministic schedule allocation — no LLM involvement per the brief.
 * Guarantees:
 *  - exactly `daysAvailable` day entries
 *  - every must-have requirement's linked question is scheduled on some day
 *  - harder / must-have-linked questions land on earlier days
 *  - integer minutes, valid question_ids only
 */
export function allocateSchedule({ requirements, questions, daysAvailable }: AllocateScheduleInput): ScheduleDay[] {
  const requirementById = new Map(requirements.map((r) => [r.id, r]));
  const isMustLinked = (q: Question) => q.requirement_ids.some((rid) => requirementById.get(rid)?.priority === "must");

  if (questions.length === 0) {
    return Array.from({ length: daysAvailable }, (_, i) => ({
      day: i + 1,
      focus: "No material available — the job description provided too little detail to generate questions",
      question_ids: [],
      minutes: 5,
    }));
  }

  const ordered = [...questions].sort((a, b) => {
    const priorityDiff = Number(isMustLinked(b)) - Number(isMustLinked(a));
    if (priorityDiff !== 0) return priorityDiff;
    return b.difficulty - a.difficulty;
  });

  if (daysAvailable === 1) {
    const minutes = ordered.reduce((sum, q) => sum + MINUTES_BY_DIFFICULTY[q.difficulty], 0);
    return [
      {
        day: 1,
        focus: "Full review — all topics",
        question_ids: ordered.map((q) => q.id),
        minutes,
      },
    ];
  }

  const contentDayCount = Math.min(daysAvailable, ordered.length);

  // Contiguous slicing (not a minute-threshold greedy fill) guarantees every
  // content day gets at least one question — `ordered` is already sorted
  // hardest/must-first, so earlier slices naturally land the harder/
  // higher-priority material on earlier days. A target-minutes threshold
  // approach was tried first and could leave trailing days completely
  // empty when there weren't enough "crossings" to advance through every
  // bucket — caught by allocateSchedule's own test suite.
  const baseSize = Math.floor(ordered.length / contentDayCount);
  const remainder = ordered.length % contentDayCount;
  const buckets: Question[][] = [];
  let cursor = 0;
  for (let i = 0; i < contentDayCount; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    buckets.push(ordered.slice(cursor, cursor + size));
    cursor += size;
  }

  const days: ScheduleDay[] = buckets.map((qs, i) => {
    const categories = [...new Set(qs.map((q) => q.category))];
    return {
      day: i + 1,
      focus: `${categories.join(" & ")} questions`,
      question_ids: qs.map((q) => q.id),
      minutes: qs.reduce((sum, q) => sum + MINUTES_BY_DIFFICULTY[q.difficulty], 0),
    };
  });

  if (daysAvailable > contentDayCount) {
    const mustQuestions = ordered.filter(isMustLinked);
    const reviewPool = mustQuestions.length > 0 ? mustQuestions : ordered;
    const extraDaysCount = daysAvailable - contentDayCount;

    for (let i = 0; i < extraDaysCount; i++) {
      const dayNum = contentDayCount + i + 1;
      const pickCount = Math.min(MAX_REVIEW_ITEMS_PER_DAY, reviewPool.length);
      const startIdx = (i * pickCount) % reviewPool.length;
      const picked: Question[] = [];
      for (let k = 0; k < pickCount; k++) {
        picked.push(reviewPool[(startIdx + k) % reviewPool.length]);
      }
      const categories = [...new Set(picked.map((q) => q.category))];
      days.push({
        day: dayNum,
        focus: `Review: ${categories.join(" & ")}`,
        question_ids: picked.map((q) => q.id),
        minutes: picked.reduce((sum, q) => sum + REVIEW_MINUTES_BY_DIFFICULTY[q.difficulty], 0),
      });
    }
  }

  return days;
}

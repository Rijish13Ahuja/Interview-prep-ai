import { describe, expect, it } from "vitest";
import { allocateSchedule } from "../src/deterministic/schedule.js";
import type { Question, Requirement } from "../src/schema/kit.js";

function req(id: string, priority: "must" | "nice"): Requirement {
  return { id, text: `req ${id}`, kind: "technical", priority, evidence: `evidence ${id}` };
}

function q(id: string, requirement_ids: string[], difficulty: 1 | 2 | 3, category: Question["category"] = "technical"): Question {
  return { id, requirement_ids, category, prompt: "p", answer_outline: "a", difficulty, origin: "ai", isLocked: false };
}

function allQuestionIdsOnSchedule(days: ReturnType<typeof allocateSchedule>): string[] {
  return days.flatMap((d) => d.question_ids);
}

describe("allocateSchedule", () => {
  it("produces exactly the number of days requested", () => {
    const requirements = [req("r1", "must")];
    const questions = [q("q1", ["r1"], 2)];
    for (const days of [1, 7, 30, 60]) {
      const schedule = allocateSchedule({ requirements, questions, daysAvailable: days });
      expect(schedule).toHaveLength(days);
      schedule.forEach((d, i) => expect(d.day).toBe(i + 1));
    }
  });

  it("uses integer minutes on every day", () => {
    const requirements = [req("r1", "must"), req("r2", "nice")];
    const questions = [q("q1", ["r1"], 3), q("q2", ["r2"], 1)];
    const schedule = allocateSchedule({ requirements, questions, daysAvailable: 5 });
    schedule.forEach((d) => expect(Number.isInteger(d.minutes)).toBe(true));
  });

  it("1-day schedule puts everything on day 1", () => {
    const requirements = [req("r1", "must"), req("r2", "must")];
    const questions = [q("q1", ["r1"], 2), q("q2", ["r2"], 3)];
    const schedule = allocateSchedule({ requirements, questions, daysAvailable: 1 });
    expect(schedule).toHaveLength(1);
    expect(schedule[0].question_ids.sort()).toEqual(["q1", "q2"]);
  });

  it("60-day schedule with few questions still produces 60 non-empty days and every must-have appears", () => {
    const requirements = [req("r1", "must"), req("r2", "must")];
    const questions = [q("q1", ["r1"], 2), q("q2", ["r2"], 3)];
    const schedule = allocateSchedule({ requirements, questions, daysAvailable: 60 });
    expect(schedule).toHaveLength(60);
    schedule.forEach((d) => expect(d.question_ids.length).toBeGreaterThan(0));

    const scheduled = new Set(allQuestionIdsOnSchedule(schedule));
    expect(scheduled.has("q1")).toBe(true);
    expect(scheduled.has("q2")).toBe(true);
  });

  it("every must-have requirement's question appears somewhere in the schedule", () => {
    const requirements = [req("r1", "must"), req("r2", "must"), req("r3", "nice")];
    const questions = [q("q1", ["r1"], 1), q("q2", ["r2"], 2), q("q3", ["r3"], 3)];
    const schedule = allocateSchedule({ requirements, questions, daysAvailable: 3 });
    const scheduled = new Set(allQuestionIdsOnSchedule(schedule));
    expect(scheduled.has("q1")).toBe(true);
    expect(scheduled.has("q2")).toBe(true);
  });

  it("places must/harder-linked questions on earlier days than nice/easier ones", () => {
    const requirements = [req("r1", "must"), req("r2", "nice")];
    const questions = [q("q1", ["r2"], 1), q("q2", ["r1"], 3)];
    const schedule = allocateSchedule({ requirements, questions, daysAvailable: 2 });
    const dayOfQ2 = schedule.find((d) => d.question_ids.includes("q2"))!.day;
    const dayOfQ1 = schedule.find((d) => d.question_ids.includes("q1"))!.day;
    expect(dayOfQ2).toBeLessThanOrEqual(dayOfQ1);
  });

  it("every question_id referenced actually exists among the input questions", () => {
    const requirements = [req("r1", "must")];
    const questions = [q("q1", ["r1"], 2)];
    const schedule = allocateSchedule({ requirements, questions, daysAvailable: 10 });
    const validIds = new Set(questions.map((qq) => qq.id));
    schedule.forEach((d) => d.question_ids.forEach((id) => expect(validIds.has(id)).toBe(true)));
  });

  it("handles zero questions without throwing, still producing the requested number of days", () => {
    const schedule = allocateSchedule({ requirements: [], questions: [], daysAvailable: 4 });
    expect(schedule).toHaveLength(4);
    schedule.forEach((d) => expect(d.question_ids).toEqual([]));
  });
});

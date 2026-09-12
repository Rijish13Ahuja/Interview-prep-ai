import { z } from "zod";

/**
 * Mirrors Appendix A of the assessment brief field-for-field.
 * Two permitted extensions are included directly on the schema (the brief
 * explicitly allows extending the structure as long as the named fields
 * stay present and exactly named):
 *  - `requirements[].evidence`  — the JD phrase a requirement was derived from
 *  - `company_brief.discussion_status` — honesty flag for public-discussion research
 *
 * `origin`/`isLocked` on questions/flashcards are builder-state metadata used
 * by the editing/regeneration flow. They are NOT part of Appendix A and are
 * stripped by `toAppendixAOutput` before anything is written as batch output.
 */

export const RequirementKind = z.enum(["technical", "behavioural", "domain"]);
export const RequirementPriority = z.enum(["must", "nice"]);
export const QuestionCategory = z.enum([
  "technical",
  "behavioural",
  "system-design",
  "company-fit",
]);
export const DiscussionStatus = z.enum(["not_configured", "no_results", "found", "search_failed"]);
export const ItemOrigin = z.enum(["ai", "user"]);

export const RequirementSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  kind: RequirementKind,
  priority: RequirementPriority,
  evidence: z.string().min(1),
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const QuestionSchema = z.object({
  id: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  category: QuestionCategory,
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
  origin: ItemOrigin,
  isLocked: z.boolean(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const FlashcardSchema = z.object({
  id: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  origin: ItemOrigin,
  isLocked: z.boolean(),
});
export type Flashcard = z.infer<typeof FlashcardSchema>;

export const ScheduleDaySchema = z.object({
  day: z.number().int().min(1),
  focus: z.string().min(1),
  question_ids: z.array(z.string().min(1)),
  minutes: z.number().int().positive(),
});
export type ScheduleDay = z.infer<typeof ScheduleDaySchema>;

export const ScheduleSchema = z.object({
  days_available: z.number().int().min(1),
  days: z.array(ScheduleDaySchema),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

export const CoverageSchema = z.object({
  uncovered_requirement_ids: z.array(z.string().min(1)),
  passes: z.number().int().min(1),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const KitSchema = z
  .object({
    source: z.object({
      company: z.string(),
      company_url: z.string(),
      role: z.string(),
      location: z.string(),
      jd_chars: z.number().int().min(0),
      researched_at: z.string(),
      pages_used: z.array(z.string()),
    }),
    company_brief: z.object({
      summary: z.string(),
      what_they_do: z.string(),
      sources: z.array(z.string()),
      discussion_status: DiscussionStatus,
    }),
    role: z.object({
      title: z.string(),
      seniority: z.string(),
      responsibilities: z.array(z.string()),
      requirements: z.array(RequirementSchema),
    }),
    questions: z.array(QuestionSchema),
    flashcards: z.array(FlashcardSchema),
    schedule: ScheduleSchema,
    coverage: CoverageSchema,
  })
  .superRefine((kit, ctx) => {
    const requirementIds = new Set(kit.role.requirements.map((r) => r.id));
    const questionIds = new Set(kit.questions.map((q) => q.id));

    if (requirementIds.size !== kit.role.requirements.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate requirement id", path: ["role", "requirements"] });
    }
    if (questionIds.size !== kit.questions.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate question id", path: ["questions"] });
    }
    const flashcardIds = new Set(kit.flashcards.map((f) => f.id));
    if (flashcardIds.size !== kit.flashcards.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Duplicate flashcard id", path: ["flashcards"] });
    }

    kit.questions.forEach((q, i) => {
      q.requirement_ids.forEach((rid) => {
        if (!requirementIds.has(rid)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `question ${q.id} references unknown requirement id ${rid}`,
            path: ["questions", i, "requirement_ids"],
          });
        }
      });
    });

    kit.flashcards.forEach((f, i) => {
      f.requirement_ids.forEach((rid) => {
        if (!requirementIds.has(rid)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `flashcard ${f.id} references unknown requirement id ${rid}`,
            path: ["flashcards", i, "requirement_ids"],
          });
        }
      });
    });

    if (kit.schedule.days.length !== kit.schedule.days_available) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "schedule.days.length must equal schedule.days_available",
        path: ["schedule", "days"],
      });
    }

    kit.schedule.days.forEach((day, i) => {
      day.question_ids.forEach((qid) => {
        if (!questionIds.has(qid)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `schedule day ${day.day} references unknown question id ${qid}`,
            path: ["schedule", "days", i, "question_ids"],
          });
        }
      });
    });

    kit.coverage.uncovered_requirement_ids.forEach((rid) => {
      if (!requirementIds.has(rid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `coverage references unknown requirement id ${rid}`,
          path: ["coverage", "uncovered_requirement_ids"],
        });
      }
    });
  });

export type Kit = z.infer<typeof KitSchema>;

/** Strips builder-only state (origin/isLocked) before writing Appendix B batch output. */
export function toAppendixAOutput(kit: Kit) {
  const strip = <T extends { origin: string; isLocked: boolean }>(item: T) => {
    const { origin, isLocked, ...rest } = item;
    return rest;
  };
  return {
    ...kit,
    questions: kit.questions.map(strip),
    flashcards: kit.flashcards.map(strip),
  };
}

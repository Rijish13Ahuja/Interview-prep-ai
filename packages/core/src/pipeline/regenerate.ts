import type { LLMCaller } from "../llm/provider.js";
import type { Question, QuestionCategory as QuestionCategoryType, Requirement } from "../schema/kit.js";
import { generateQuestionsForCategory } from "./questions.js";
import type { z } from "zod";

type QuestionCategoryName = z.infer<typeof QuestionCategoryType>;

function nextIdAfter(existing: { id: string }[], prefix: string): number {
  const max = existing.reduce((m, item) => {
    const n = Number(item.id.replace(prefix, ""));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return max + 1;
}

/**
 * Regenerates one question category, preserving every locked item (user-
 * created, edited, or explicitly pinned) in that category and every item
 * in every other category untouched — only unlocked, untouched AI content
 * within the target category is eligible for replacement. This is the same
 * generateQuestionsForCategory used during initial generation, so a
 * regenerated category behaves identically to how that category was first
 * produced.
 */
export async function regenerateCategoryQuestions(
  params: {
    category: QuestionCategoryName;
    requirements: Requirement[];
    existingQuestions: Question[];
    roleContext: { title: string; seniority: string };
    companyBriefSummary?: string;
  },
  call: LLMCaller
): Promise<Question[]> {
  const untouchedOtherCategories = params.existingQuestions.filter((q) => q.category !== params.category);
  const lockedInCategory = params.existingQuestions.filter((q) => q.category === params.category && q.isLocked);

  const relevantRequirements =
    params.category === "behavioural"
      ? params.requirements.filter((r) => r.kind === "behavioural")
      : params.category === "technical" || params.category === "system-design"
        ? params.requirements.filter((r) => r.kind !== "behavioural")
        : [];

  const idSeed = nextIdAfter(params.existingQuestions, "q");
  const generated = await generateQuestionsForCategory(
    {
      category: params.category,
      requirements: relevantRequirements,
      companyContext: params.category === "company-fit" ? params.companyBriefSummary : undefined,
      roleContext: params.roleContext,
    },
    call,
    idSeed
  );

  return [...untouchedOtherCategories, ...lockedInCategory, ...generated];
}

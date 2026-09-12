// Mirrors the Appendix A kit shape (plus the API's builder-state extensions).
// Kept local to the frontend rather than importing packages/core's runtime
// (which pulls in node-only crawler/LLM code) — this is a pure type contract.

export type RequirementKind = "technical" | "behavioural" | "domain";
export type RequirementPriority = "must" | "nice";
export type QuestionCategoryName = "technical" | "behavioural" | "system-design" | "company-fit";
export type DiscussionStatus = "not_configured" | "no_results" | "found" | "search_failed";
export type ItemOrigin = "ai" | "user";

export interface Requirement {
  id: string;
  text: string;
  kind: RequirementKind;
  priority: RequirementPriority;
  evidence: string;
}

export interface Question {
  id: string;
  requirement_ids: string[];
  category: QuestionCategoryName;
  prompt: string;
  answer_outline: string;
  difficulty: 1 | 2 | 3;
  origin: ItemOrigin;
  isLocked: boolean;
}

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  requirement_ids: string[];
  origin: ItemOrigin;
  isLocked: boolean;
}

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface Kit {
  source: {
    company: string;
    company_url: string;
    role: string;
    location: string;
    jd_chars: number;
    researched_at: string;
    pages_used: string[];
  };
  company_brief: {
    summary: string;
    what_they_do: string;
    sources: string[];
    discussion_status: DiscussionStatus;
  };
  role: {
    title: string;
    seniority: string;
    responsibilities: string[];
    requirements: Requirement[];
  };
  questions: Question[];
  flashcards: Flashcard[];
  schedule: { days_available: number; days: ScheduleDay[] };
  coverage: { uncovered_requirement_ids: string[]; passes: number };
}

export type KitRunStatus = "pending" | "generating" | "ok" | "failed";

export interface KitSummary {
  id: string;
  status: KitRunStatus;
  step: string | null;
  error: { code: string; message: string } | null;
  jd_preview: string;
  company_url: string;
  days: number;
  company: string | null;
  role: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KitDetail extends KitSummary {
  companyBriefLocked: boolean;
  practice: { confidenceByCardId: Record<string, number>; coveredCardIds: string[] };
  kit: Kit | null;
}

export const QUESTION_CATEGORIES: QuestionCategoryName[] = ["technical", "behavioural", "system-design", "company-fit"];

export const GENERATION_STEP_LABELS: Record<string, string> = {
  extracting_requirements: "Reading the job description",
  researching_company: "Crawling the company site",
  researching_discussion: "Looking for public interview discussion",
  writing_company_brief: "Writing the company brief",
  generating_technical_questions: "Generating technical questions",
  generating_behavioural_questions: "Generating behavioural questions",
  generating_system_design_questions: "Generating system-design questions",
  generating_company_fit_questions: "Generating company-fit questions",
  checking_coverage: "Checking requirement coverage",
  filling_gaps: "Filling coverage gaps",
  generating_flashcards: "Generating flashcards",
  building_schedule: "Building the study schedule",
  validating: "Validating the kit",
};

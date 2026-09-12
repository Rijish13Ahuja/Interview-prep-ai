import { KitSchema, type Kit, type Requirement } from "../schema/kit.js";
import type { LLMCaller } from "../llm/provider.js";
import type { DiscussionSearch } from "../research/discussionSearch.js";
import type { CrawlOptions, CrawledPage } from "../crawler/crawler.js";
import { extractRequirements } from "./extractRequirements.js";
import { generateCompanyBrief } from "./companyBrief.js";
import { generateQuestionsForCategory, groupRequirementsByCategory } from "./questions.js";
import { generateFlashcards } from "./flashcards.js";
import { computeCoverage } from "../deterministic/coverage.js";
import { allocateSchedule } from "../deterministic/schedule.js";
import { researchPublicDiscussion } from "../research/discussionSearch.js";

export interface GenerateKitInput {
  jd: string;
  company_url: string;
  days: number;
}

/** The crawler is injected as a function so tests never need real network I/O. */
export type CrawlFn = (seedUrl: string, options: CrawlOptions) => Promise<{ pagesUsed: CrawledPage[]; skipped: { url: string; reason: string }[] }>;

export type GenerationStep =
  | "extracting_requirements"
  | "researching_company"
  | "researching_discussion"
  | "writing_company_brief"
  | "generating_technical_questions"
  | "generating_behavioural_questions"
  | "generating_system_design_questions"
  | "generating_company_fit_questions"
  | "checking_coverage"
  | "filling_gaps"
  | "generating_flashcards"
  | "building_schedule"
  | "validating";

export interface PipelineDeps {
  call: LLMCaller;
  discussionSearch: DiscussionSearch | null;
  crawl: CrawlFn;
  crawlOptions: CrawlOptions;
  now?: () => Date;
  /** Optional progress hook — lets the API surface "visible progress" while generation runs. Never required for correctness. */
  onStep?: (step: GenerationStep) => void;
}

export type GenerateKitResult = { status: "ok"; kit: Kit } | { status: "failed"; error: { code: string; message: string } };

function extractCompanyName(companyUrl: string): string {
  try {
    return new URL(companyUrl).hostname.replace(/^www\./, "").split(".")[0];
  } catch {
    return companyUrl || "the company";
  }
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * The single source of truth for kit generation — called identically by the
 * HTTP API and the batch CLI. Has no Express/Mongo/Next dependency; every
 * external effect (LLM calls, crawling, search) is injected via `deps`.
 */
export async function generateKit(input: GenerateKitInput, deps: PipelineDeps): Promise<GenerateKitResult> {
  const now = deps.now ?? (() => new Date());

  if (!input.jd || input.jd.trim().length === 0) {
    return { status: "failed", error: { code: "INVALID_INPUT", message: "Job description is empty" } };
  }
  if (!Number.isInteger(input.days) || input.days < 1) {
    return { status: "failed", error: { code: "INVALID_INPUT", message: "days must be an integer >= 1" } };
  }

  // 1. Requirement extraction — the ONLY step whose total failure is fatal to the case.
  deps.onStep?.("extracting_requirements");
  const extraction = await extractRequirements(input.jd, deps.call);
  if (extraction.fatal) {
    return { status: "failed", error: { code: "EXTRACTION_FAILED", message: extraction.errorMessage ?? "Requirement extraction failed" } };
  }
  const requirements = extraction.requirements;

  // 2. Crawl company site — partial failure only, never fatal.
  deps.onStep?.("researching_company");
  let pagesUsed: CrawledPage[] = [];
  if (isValidUrl(input.company_url)) {
    try {
      const crawlResult = await deps.crawl(input.company_url, deps.crawlOptions);
      pagesUsed = crawlResult.pagesUsed;
    } catch {
      pagesUsed = [];
    }
  }

  // 3. Public discussion research — optional, single attempt, never fatal.
  deps.onStep?.("researching_discussion");
  const companyName = extractCompanyName(input.company_url);
  const discussion = await researchPublicDiscussion(companyName, deps.discussionSearch);

  // 4. Company brief — deterministically gated on real crawled content (see companyBrief.ts).
  deps.onStep?.("writing_company_brief");
  const brief = await generateCompanyBrief(companyName, pagesUsed, deps.call);

  // 5. Question generation, separately by category.
  const grouped = groupRequirementsByCategory(requirements);
  const roleTitle = extraction.title || "Unspecified Role";
  const roleContext = { title: roleTitle, seniority: extraction.seniority || "unspecified" };

  let nextId = 1;
  const allQuestions = [];
  const categoryPlan = [
    { category: "technical" as const, requirements: grouped.technical ?? [] },
    { category: "behavioural" as const, requirements: grouped.behavioural ?? [] },
    { category: "system-design" as const, requirements: grouped.technical ?? [] },
    { category: "company-fit" as const, requirements: [] as Requirement[] },
  ];

  const stepByCategory: Record<string, GenerationStep> = {
    technical: "generating_technical_questions",
    behavioural: "generating_behavioural_questions",
    "system-design": "generating_system_design_questions",
    "company-fit": "generating_company_fit_questions",
  };

  for (const plan of categoryPlan) {
    deps.onStep?.(stepByCategory[plan.category]);
    const generated = await generateQuestionsForCategory(
      {
        category: plan.category,
        requirements: plan.requirements,
        companyContext: plan.category === "company-fit" ? brief.summary : undefined,
        roleContext,
      },
      deps.call,
      nextId
    );
    allQuestions.push(...generated);
    nextId += generated.length;
  }

  // 6. Coverage — deterministic.
  deps.onStep?.("checking_coverage");
  let coverage = computeCoverage(requirements, allQuestions);
  let passes = 1;

  // 7. Gap-fill — at most one additional pass, batched by category (not per requirement).
  if (coverage.uncoveredRequirementIds.length > 0) {
    deps.onStep?.("filling_gaps");
    const uncoveredRequirements = requirements.filter((r) => coverage.uncoveredRequirementIds.includes(r.id));
    const gapGroups = groupRequirementsByCategory(uncoveredRequirements);

    for (const [category, reqs] of Object.entries(gapGroups) as ["technical" | "behavioural", Requirement[]][]) {
      if (!reqs || reqs.length === 0) continue;
      const generated = await generateQuestionsForCategory({ category, requirements: reqs, roleContext }, deps.call, nextId);
      allQuestions.push(...generated);
      nextId += generated.length;
    }

    coverage = computeCoverage(requirements, allQuestions);
    passes = 2;
  }

  // 8. Flashcards — one batched call, deterministic fallback on exhaustion.
  deps.onStep?.("generating_flashcards");
  const flashcards = await generateFlashcards(requirements, allQuestions, deps.call);

  // 9. Schedule — deterministic.
  deps.onStep?.("building_schedule");
  const scheduleDays = allocateSchedule({ requirements, questions: allQuestions, daysAvailable: input.days });
  deps.onStep?.("validating");

  const discussionNote =
    discussion.status === "found"
      ? ` Public discussion of the interview process was found: ${discussion.results.map((r) => r.snippet).join(" ")}`
      : discussion.status === "no_results"
        ? " No public discussion of the interview process was found."
        : ""; // not_configured / search_failed → stay silent, never assert a negative that was never actually checked

  const kit: Kit = {
    source: {
      company: companyName,
      company_url: input.company_url,
      role: roleTitle,
      location: extraction.location,
      jd_chars: input.jd.length,
      researched_at: now().toISOString(),
      pages_used: pagesUsed.map((p) => p.url),
    },
    company_brief: {
      summary: `${brief.summary}${discussionNote}`,
      what_they_do: brief.what_they_do,
      sources: brief.sources,
      discussion_status: discussion.status,
    },
    role: {
      title: roleTitle,
      seniority: roleContext.seniority,
      responsibilities: extraction.responsibilities,
      requirements,
    },
    questions: allQuestions,
    flashcards,
    schedule: { days_available: input.days, days: scheduleDays },
    coverage: { uncovered_requirement_ids: coverage.uncoveredRequirementIds, passes },
  };

  const validated = KitSchema.safeParse(kit);
  if (!validated.success) {
    return {
      status: "failed",
      error: {
        code: "INVALID_KIT_STRUCTURE",
        message: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
    };
  }

  return { status: "ok", kit: validated.data };
}

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  KitSchema,
  QuestionCategory,
  allocateSchedule,
  generateCompanyBrief,
  regenerateCategoryQuestions,
  type GenerationStep,
  type Kit,
  type PipelineDeps,
} from "@trao/core";
import { requireAuth } from "../middleware/requireAuth.js";
import { runGeneration } from "../generation/runGeneration.js";
import type { KitStore, StoredKit } from "../store/types.js";
import {
  filterKnownRequirementIds,
  findFlashcardIndex,
  findQuestionIndex,
  nextIdAfter,
  pruneScheduleReferences,
  recomputeCoverage,
} from "./kitMutations.js";

const CreateKitSchema = z.object({
  jd: z.string().min(1, "Job description is required"),
  company_url: z.string().min(1, "Company URL is required"),
  days: z.number().int().min(1).max(90),
});

const QuestionEditSchema = z.object({
  prompt: z.string().min(1).optional(),
  answer_outline: z.string().min(1).optional(),
  category: QuestionCategory.optional(),
  difficulty: z.number().int().min(1).max(3).optional(),
  requirement_ids: z.array(z.string()).optional(),
});

const QuestionCreateSchema = z.object({
  category: QuestionCategory,
  prompt: z.string().min(1),
  answer_outline: z.string().min(1),
  difficulty: z.number().int().min(1).max(3),
  requirement_ids: z.array(z.string()).default([]),
});

const FlashcardEditSchema = z.object({
  front: z.string().min(1).optional(),
  back: z.string().min(1).optional(),
  requirement_ids: z.array(z.string()).optional(),
});

const FlashcardCreateSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()).default([]),
});

const ReorderQuestionsSchema = z.object({
  orderedIds: z.array(z.string()).min(1),
});

const CompanyBriefEditSchema = z.object({
  summary: z.string().min(1).optional(),
  what_they_do: z.string().min(1).optional(),
});

const PracticeUpdateSchema = z.object({
  cardId: z.string().min(1),
  confidence: z.number().int().min(1).max(3),
});

const REGENERATABLE_CATEGORIES = ["technical", "behavioural", "system-design", "company-fit"] as const;

function summarize(stored: StoredKit) {
  return {
    id: stored.id,
    status: stored.status,
    step: stored.step,
    error: stored.error,
    jd_preview: stored.jd.length > 120 ? `${stored.jd.slice(0, 117)}...` : stored.jd,
    company_url: stored.companyUrl,
    days: stored.days,
    company: stored.kit?.source.company ?? null,
    role: stored.kit?.source.role ?? null,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function detail(stored: StoredKit) {
  return { ...summarize(stored), companyBriefLocked: stored.companyBriefLocked, practice: stored.practice, kit: stored.kit };
}

async function saveValidatedKit(kitStore: KitStore, id: string, kit: Kit): Promise<{ ok: true; stored: StoredKit } | { ok: false; message: string }> {
  const validated = KitSchema.safeParse(kit);
  if (!validated.success) {
    return { ok: false, message: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  const stored = await kitStore.update(id, { kit: validated.data });
  if (!stored) return { ok: false, message: "Kit disappeared during update" };
  return { ok: true, stored };
}

export function createKitsRouter(kitStore: KitStore, buildPipelineDeps: (onStep?: (step: GenerationStep) => void) => PipelineDeps): Router {
  const router = Router();
  router.use(requireAuth);

  async function loadOwnedKit(req: Request, res: Response): Promise<StoredKit | null> {
    const stored = await kitStore.findById(String(req.params.id));
    if (!stored || stored.ownerId !== req.session.userId) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Kit not found." } });
      return null;
    }
    return stored;
  }

  /** Loads the kit and ensures it has a generated, editable body — 409 while pending/generating/failed. */
  async function loadReadyKit(req: Request, res: Response): Promise<StoredKit | null> {
    const stored = await loadOwnedKit(req, res);
    if (!stored) return null;
    if (stored.status !== "ok" || !stored.kit) {
      res.status(409).json({ error: { code: "KIT_NOT_READY", message: `Kit is not ready for edits (status: ${stored.status}).` } });
      return null;
    }
    return stored;
  }

  router.get("/", async (req, res) => {
    const kits = await kitStore.findByOwner(req.session.userId!);
    res.json({ kits: kits.map(summarize) });
  });

  router.post("/", async (req, res) => {
    const parsed = CreateKitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const stored = await kitStore.create({ ownerId: req.session.userId!, jd: parsed.data.jd, companyUrl: parsed.data.company_url, days: parsed.data.days });
    await kitStore.update(stored.id, { status: "generating", step: "extracting_requirements" });

    runGeneration(stored.id, { jd: parsed.data.jd, company_url: parsed.data.company_url, days: parsed.data.days }, kitStore, buildPipelineDeps).catch(() => {
      // runGeneration already writes failure state internally — this catch only guards against a truly unexpected throw
    });

    res.status(202).json(summarize({ ...stored, status: "generating", step: "extracting_requirements" }));
  });

  router.get("/:id", async (req, res) => {
    const stored = await loadOwnedKit(req, res);
    if (!stored) return;
    res.json(detail(stored));
  });

  // --- Company brief ---

  router.patch("/:id/company-brief", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const parsed = CompanyBriefEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const kit: Kit = { ...stored.kit!, company_brief: { ...stored.kit!.company_brief, ...parsed.data } };
    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    await kitStore.update(stored.id, { companyBriefLocked: true });
    res.json(detail({ ...result.stored, companyBriefLocked: true }));
  });

  router.post("/:id/regenerate/company-brief", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const force = req.body?.force === true;

    if (stored.companyBriefLocked && !force) {
      res.status(409).json({ error: { code: "COMPANY_BRIEF_LOCKED", message: "The company brief has manual edits. Pass force=true to discard them and regenerate." } });
      return;
    }

    const deps = buildPipelineDeps();
    let pages: { url: string; text: string }[] = [];
    try {
      const crawlResult = await deps.crawl(stored.companyUrl, deps.crawlOptions);
      pages = crawlResult.pagesUsed;
    } catch {
      pages = [];
    }

    const brief = await generateCompanyBrief(stored.kit!.source.company, pages, deps.call);
    const kit: Kit = {
      ...stored.kit!,
      company_brief: { ...stored.kit!.company_brief, summary: brief.summary, what_they_do: brief.what_they_do, sources: brief.sources },
      source: { ...stored.kit!.source, pages_used: pages.map((p) => p.url) },
    };

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    await kitStore.update(stored.id, { companyBriefLocked: false });
    res.json(detail({ ...result.stored, companyBriefLocked: false }));
  });

  // --- Questions ---

  router.post("/:id/regenerate/questions/:category", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const category = req.params.category as (typeof REGENERATABLE_CATEGORIES)[number];
    if (!REGENERATABLE_CATEGORIES.includes(category)) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: `category must be one of ${REGENERATABLE_CATEGORIES.join(", ")}` } });
      return;
    }

    const deps = buildPipelineDeps();
    const kitBefore = stored.kit!;
    const newQuestions = await regenerateCategoryQuestions(
      {
        category,
        requirements: kitBefore.role.requirements,
        existingQuestions: kitBefore.questions,
        roleContext: { title: kitBefore.role.title, seniority: kitBefore.role.seniority },
        companyBriefSummary: kitBefore.company_brief.summary,
      },
      deps.call
    );

    const validQuestionIds = new Set(newQuestions.map((q) => q.id));
    const kit: Kit = {
      ...kitBefore,
      questions: newQuestions,
      schedule: pruneScheduleReferences(kitBefore.schedule, validQuestionIds),
    };
    kit.coverage = recomputeCoverage(kit);

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.json(detail(result.stored));
  });

  // Registered before the parameterized "/:id/questions/:questionId" route below —
  // Express matches routes in registration order, and "reorder" would otherwise be
  // captured as a :questionId value, shadowing this route entirely (caught by tests).
  router.patch("/:id/questions/reorder", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const parsed = ReorderQuestionsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const kitBefore = stored.kit!;
    const byId = new Map(kitBefore.questions.map((q) => [q.id, q]));
    const orderedIdSet = new Set(parsed.data.orderedIds);
    if (parsed.data.orderedIds.some((id) => !byId.has(id)) || orderedIdSet.size !== kitBefore.questions.length) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: "orderedIds must contain exactly the current question ids." } });
      return;
    }

    const questions = parsed.data.orderedIds.map((id) => byId.get(id)!);
    const kit: Kit = { ...kitBefore, questions };
    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.json(detail(result.stored));
  });

  router.patch("/:id/questions/:questionId", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const parsed = QuestionEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const kitBefore = stored.kit!;
    const idx = findQuestionIndex(kitBefore, req.params.questionId);
    if (idx === -1) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found." } });
      return;
    }

    const patch = { ...parsed.data };
    if (patch.requirement_ids) patch.requirement_ids = filterKnownRequirementIds(patch.requirement_ids, kitBefore.role.requirements);

    const questions = [...kitBefore.questions];
    questions[idx] = { ...questions[idx], ...patch, isLocked: true };
    const kit: Kit = { ...kitBefore, questions };
    kit.coverage = recomputeCoverage(kit);

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.json(detail(result.stored));
  });

  router.post("/:id/questions", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const parsed = QuestionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const kitBefore = stored.kit!;
    const id = nextIdAfter(kitBefore.questions, "q");
    const requirement_ids = filterKnownRequirementIds(parsed.data.requirement_ids, kitBefore.role.requirements);
    const kit: Kit = {
      ...kitBefore,
      questions: [...kitBefore.questions, { id, ...parsed.data, requirement_ids, origin: "user", isLocked: true }],
    };
    kit.coverage = recomputeCoverage(kit);

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.status(201).json(detail(result.stored));
  });

  router.delete("/:id/questions/:questionId", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const kitBefore = stored.kit!;
    const idx = findQuestionIndex(kitBefore, req.params.questionId);
    if (idx === -1) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Question not found." } });
      return;
    }

    const questions = kitBefore.questions.filter((q) => q.id !== req.params.questionId);
    const validQuestionIds = new Set(questions.map((q) => q.id));
    const kit: Kit = { ...kitBefore, questions, schedule: pruneScheduleReferences(kitBefore.schedule, validQuestionIds) };
    kit.coverage = recomputeCoverage(kit);

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.json(detail(result.stored));
  });

  // --- Flashcards ---

  router.patch("/:id/flashcards/:flashcardId", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const parsed = FlashcardEditSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const kitBefore = stored.kit!;
    const idx = findFlashcardIndex(kitBefore, req.params.flashcardId);
    if (idx === -1) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Flashcard not found." } });
      return;
    }

    const patch = { ...parsed.data };
    if (patch.requirement_ids) patch.requirement_ids = filterKnownRequirementIds(patch.requirement_ids, kitBefore.role.requirements);

    const flashcards = [...kitBefore.flashcards];
    flashcards[idx] = { ...flashcards[idx], ...patch, isLocked: true };
    const kit: Kit = { ...kitBefore, flashcards };

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.json(detail(result.stored));
  });

  router.post("/:id/flashcards", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const parsed = FlashcardCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const kitBefore = stored.kit!;
    const id = nextIdAfter(kitBefore.flashcards, "f");
    const requirement_ids = filterKnownRequirementIds(parsed.data.requirement_ids, kitBefore.role.requirements);
    const kit: Kit = {
      ...kitBefore,
      flashcards: [...kitBefore.flashcards, { id, ...parsed.data, requirement_ids, origin: "user", isLocked: true }],
    };

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.status(201).json(detail(result.stored));
  });

  router.delete("/:id/flashcards/:flashcardId", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const kitBefore = stored.kit!;
    const idx = findFlashcardIndex(kitBefore, req.params.flashcardId);
    if (idx === -1) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Flashcard not found." } });
      return;
    }

    const flashcards = kitBefore.flashcards.filter((f) => f.id !== req.params.flashcardId);
    const kit: Kit = { ...kitBefore, flashcards };
    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.json(detail(result.stored));
  });

  // --- Schedule ---

  router.post("/:id/regenerate/schedule", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const kitBefore = stored.kit!;
    const days = allocateSchedule({ requirements: kitBefore.role.requirements, questions: kitBefore.questions, daysAvailable: kitBefore.schedule.days_available });
    const kit: Kit = { ...kitBefore, schedule: { ...kitBefore.schedule, days } };

    const result = await saveValidatedKit(kitStore, stored.id, kit);
    if (!result.ok) {
      res.status(500).json({ error: { code: "SAVE_FAILED", message: result.message } });
      return;
    }
    res.json(detail(result.stored));
  });

  // --- Practice ---

  router.patch("/:id/practice", async (req, res) => {
    const stored = await loadReadyKit(req, res);
    if (!stored) return;
    const parsed = PracticeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { code: "INVALID_INPUT", message: parsed.error.issues[0]?.message ?? "Invalid input" } });
      return;
    }

    const cardExists = stored.kit!.flashcards.some((f) => f.id === parsed.data.cardId);
    if (!cardExists) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Flashcard not found." } });
      return;
    }

    const practice = {
      confidenceByCardId: { ...stored.practice.confidenceByCardId, [parsed.data.cardId]: parsed.data.confidence },
      coveredCardIds: stored.practice.coveredCardIds.includes(parsed.data.cardId)
        ? stored.practice.coveredCardIds
        : [...stored.practice.coveredCardIds, parsed.data.cardId],
    };

    const updated = await kitStore.update(stored.id, { practice });
    res.json(detail(updated!));
  });

  return router;
}

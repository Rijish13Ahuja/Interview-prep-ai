import { z } from "zod";
import type { LLMCaller } from "../llm/provider.js";
import type { Flashcard, Question, Requirement } from "../schema/kit.js";

const FRONT_FALLBACK_MAX_CHARS = 140;
const BACK_FALLBACK_MAX_CHARS = 200;

const FlashcardItemSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  requirement_ids: z.array(z.string()),
});

export const FlashcardsResponseSchema = z.object({ flashcards: z.array(FlashcardItemSchema) });

function buildFlashcardsPrompt(requirements: Requirement[]): string {
  const reqList = requirements.map((r) => `- [${r.id}] ${r.text}`).join("\n");
  return `Create concise study flashcards covering the concepts behind these interview requirements. Each
flashcard needs a short, focused "front" (a specific recall question about ONE concept — not a full interview
question) and a concise "back" (a short factual answer, 1-2 sentences — not a full interview answer outline).

Requirements:
${reqList}

Return ONLY JSON matching:
{ "flashcards": [{ "front": string, "back": string, "requirement_ids": string[] }] }`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

/** Fallback used only if the batched flashcard call is exhausted — keeps the kit schema-valid regardless. */
function deterministicFallback(questions: Question[]): Flashcard[] {
  return questions.map((q, i) => ({
    id: `f${i + 1}`,
    front: truncate(q.prompt, FRONT_FALLBACK_MAX_CHARS),
    back: truncate(q.answer_outline, BACK_FALLBACK_MAX_CHARS),
    requirement_ids: q.requirement_ids,
    origin: "ai" as const,
    isLocked: false,
  }));
}

/** Exactly one batched LLM call for the whole kit — not per-category, not per-requirement. */
export async function generateFlashcards(requirements: Requirement[], questions: Question[], call: LLMCaller): Promise<Flashcard[]> {
  if (requirements.length === 0) return [];

  const result = await call(buildFlashcardsPrompt(requirements), FlashcardsResponseSchema);
  if (!result.ok) {
    return deterministicFallback(questions);
  }

  const validRequirementIds = new Set(requirements.map((r) => r.id));
  const flashcards: Flashcard[] = result.data.flashcards.map((f, i) => ({
    id: `f${i + 1}`,
    front: f.front,
    back: f.back,
    requirement_ids: f.requirement_ids.filter((rid) => validRequirementIds.has(rid)),
    origin: "ai" as const,
    isLocked: false,
  }));

  return flashcards.length > 0 ? flashcards : deterministicFallback(questions);
}

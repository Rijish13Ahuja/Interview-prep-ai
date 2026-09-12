import { generateKit, type GenerationStep, type PipelineDeps } from "@trao/core";
import type { KitStore } from "../store/types.js";

/**
 * Runs generateKit() in the background and updates the stored kit as it
 * progresses — the route handler that calls this does NOT await it, so the
 * HTTP response returns immediately and the frontend polls GET /kits/:id
 * for status/step. Never throws — every outcome is written to the store.
 */
export async function runGeneration(
  kitId: string,
  input: { jd: string; company_url: string; days: number },
  kitStore: KitStore,
  buildDeps: (onStep: (step: GenerationStep) => void) => PipelineDeps
): Promise<void> {
  console.log(`[generation:${kitId}] starting`);

  try {
    // buildDeps() can throw synchronously (e.g. missing GEMINI_API_KEY) — must be
    // inside this try, otherwise the failure never reaches the catch below and the
    // kit is left stuck in "generating" forever with no recorded error.
    const deps = buildDeps((step) => {
      console.log(`[generation:${kitId}] step -> ${step}`);
      kitStore.update(kitId, { step }).catch((err) => {
        console.error(`[generation:${kitId}] failed to persist step "${step}":`, err);
      });
    });

    const result = await generateKit(input, deps);
    if (result.status === "ok") {
      console.log(`[generation:${kitId}] completed ok`);
      await kitStore.update(kitId, { status: "ok", step: null, error: null, kit: result.kit });
    } else {
      console.error(`[generation:${kitId}] failed:`, result.error);
      await kitStore.update(kitId, { status: "failed", step: null, error: result.error, kit: null });
    }
  } catch (err) {
    console.error(`[generation:${kitId}] unexpected error:`, err);
    await kitStore.update(kitId, {
      status: "failed",
      step: null,
      error: { code: "UNEXPECTED_ERROR", message: err instanceof Error ? err.message : String(err) },
      kit: null,
    });
  }
}

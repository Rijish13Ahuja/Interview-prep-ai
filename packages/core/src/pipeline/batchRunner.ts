import type { BatchCase, BatchOutput, BatchResult } from "../schema/batch.js";
import { toAppendixAOutput } from "../schema/kit.js";
import { generateKit, type GenerateKitInput, type GenerateKitResult, type PipelineDeps } from "./orchestrator.js";

export type GenerateKitFn = (input: GenerateKitInput, deps: PipelineDeps) => Promise<GenerateKitResult>;

/**
 * Runs the exact same generateKit() pipeline used by the HTTP API over a
 * list of batch cases, isolating per-case failures so one bad case never
 * aborts the run — this is the function scripts/evaluate.ts calls, kept
 * independent of the CLI's argv/file-I/O plumbing so it's directly testable.
 */
export async function runBatch(
  cases: BatchCase[],
  deps: PipelineDeps,
  generate: GenerateKitFn = generateKit
): Promise<BatchOutput> {
  const kits: BatchResult[] = [];

  for (const c of cases) {
    try {
      const result = await generate({ jd: c.jd, company_url: c.company_url, days: c.days }, deps);
      if (result.status === "ok") {
        kits.push({ id: c.id, status: "ok", kit: toAppendixAOutput(result.kit), error: null });
      } else {
        kits.push({ id: c.id, status: "failed", kit: null, error: result.error });
      }
    } catch (err) {
      // A case must never abort the run, even on an unexpected thrown error.
      kits.push({
        id: c.id,
        status: "failed",
        kit: null,
        error: { code: "UNEXPECTED_ERROR", message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return { version: "1.0", generated_at: new Date().toISOString(), kits };
}

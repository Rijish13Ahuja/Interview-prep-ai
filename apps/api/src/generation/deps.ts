import { createGeminiTransport, createGoogleCseSearch, createLLMCaller, crawlCompanySite, type DiscussionSearch, type GenerationStep, type PipelineDeps } from "@trao/core";

/**
 * Optional — public-discussion research degrades honestly (not_configured)
 * when these aren't set, per the finalized design. Never required for the
 * app or the batch CLI to function.
 */
function buildDiscussionSearch(): DiscussionSearch | null {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return null;
  return createGoogleCseSearch({ apiKey, cx });
}

/** Builds real PipelineDeps for the running API process — the batch CLI builds its own equivalent for its own process. */
export function buildPipelineDeps(onStep?: (step: GenerationStep) => void): PipelineDeps {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required — see .env.example");
  }

  const transport = createGeminiTransport({
    apiKey,
    model: process.env.GEMINI_MODEL,
    baseUrl: process.env.GEMINI_BASE_URL,
  });

  return {
    call: createLLMCaller(transport),
    discussionSearch: buildDiscussionSearch(),
    crawl: crawlCompanySite,
    // The live API never allows loopback targets — ALLOW_LOOPBACK_URLS is read only by the
    // batch CLI (scripts/evaluate.ts), which is the one context that legitimately needs it
    // (per Appendix B's local-evaluation-server example). This isn't gated behind an env
    // check here; the capability simply doesn't exist in this code path, so an
    // ALLOW_LOOPBACK_URLS value accidentally left set in the live API's environment has
    // no effect.
    crawlOptions: { allowLoopback: false },
    onStep,
  };
}

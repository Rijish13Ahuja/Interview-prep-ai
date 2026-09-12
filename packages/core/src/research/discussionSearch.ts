export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Tiny provider boundary — the concrete search provider is chosen later and is fully swappable. */
export interface DiscussionSearch {
  search(query: string): Promise<SearchResult[]>;
}

/**
 * Structurally identical to (and assignable into) the `discussion_status`
 * enum on Kit's company_brief — kept as its own declaration rather than a
 * shared import to avoid an export-name collision through the package's
 * barrel file; the two are intentionally the same four string values.
 */
export type DiscussionResearchStatus = "not_configured" | "no_results" | "found" | "search_failed";

export interface DiscussionResearchResult {
  status: DiscussionResearchStatus;
  results: SearchResult[];
}

/**
 * Distinguishes "we looked and found nothing" from "we never looked" —
 * the pipeline must never claim the former when only the latter is true.
 * Exactly one attempt, no retry: this is an optional enhancement, and
 * spending retry budget on it isn't worth it when "not found" is already
 * an accepted, honest outcome. Never throws — this step must never fail
 * the kit.
 */
export async function researchPublicDiscussion(
  companyName: string,
  search: DiscussionSearch | null
): Promise<DiscussionResearchResult> {
  if (!search) {
    return { status: "not_configured", results: [] };
  }

  try {
    const results = await search.search(`"${companyName}" interview process software engineer`);
    return results.length === 0 ? { status: "no_results", results: [] } : { status: "found", results };
  } catch {
    return { status: "search_failed", results: [] };
  }
}

import type { DiscussionSearch, SearchResult } from "./discussionSearch.js";

export interface GoogleCseConfig {
  apiKey: string;
  cx: string;
  /** Override for local testing against a mock server; defaults to the real Google CSE endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "https://www.googleapis.com/customsearch/v1";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_RESULTS = 5;

/**
 * Google Programmable Search Engine (Custom Search JSON API) — the primary
 * provider chosen for public interview-discussion research. Deliberately a
 * single attempt with no retry (see discussionSearch.ts): this is an
 * optional enhancement, not something worth spending retry budget on, and
 * `researchPublicDiscussion` already treats any failure here as an honest
 * "search_failed" state rather than blocking the kit.
 */
export function createGoogleCseSearch(config: GoogleCseConfig): DiscussionSearch {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

  return {
    async search(query: string): Promise<SearchResult[]> {
      const url = new URL(baseUrl);
      url.searchParams.set("key", config.apiKey);
      url.searchParams.set("cx", config.cx);
      url.searchParams.set("q", query);
      url.searchParams.set("num", String(MAX_RESULTS));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      let res: Response;
      try {
        res = await fetch(url.toString(), { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!res.ok) {
        throw new Error(`Google CSE request failed: HTTP ${res.status}`);
      }

      const json: any = await res.json();
      const items = Array.isArray(json.items) ? json.items : [];
      return items.slice(0, MAX_RESULTS).map(
        (item: any): SearchResult => ({
          title: String(item.title ?? ""),
          url: String(item.link ?? ""),
          snippet: String(item.snippet ?? ""),
        })
      );
    },
  };
}

import * as cheerio from "cheerio";
import robotsParserModule from "robots-parser";
import { safeFetch, type SafeFetchOptions } from "./fetcher.js";

// robots-parser's shipped .d.ts resolves to a non-callable shape under NodeNext —
// its actual runtime export is `function(url, contents) => Robot`, per its own source.
interface RobotsRules {
  isAllowed(url: string, ua?: string): boolean | undefined;
}
const robotsParser = robotsParserModule as unknown as (url: string, contents: string) => RobotsRules;

export interface CrawlOptions extends SafeFetchOptions {
  maxPages?: number;
  requestDelayMs?: number;
}

export interface CrawledPage {
  url: string;
  text: string;
}

export interface CrawlResult {
  pagesUsed: CrawledPage[];
  skipped: { url: string; reason: string }[];
}

const DEFAULT_MAX_PAGES = 12;
const DEFAULT_REQUEST_DELAY_MS = 300;

const HIGH_WEIGHT_KEYWORDS = ["career", "careers", "jobs", "hiring", "join-us", "join", "work-with-us", "open-positions", "open-roles"];
const MEDIUM_WEIGHT_KEYWORDS = ["about", "team", "culture", "handbook", "engineering", "blog", "life-at"];

export interface RankedLink {
  url: string;
  text: string;
  score: number;
}

export function scoreLink(href: string, anchorText: string): number {
  const haystack = `${href} ${anchorText}`.toLowerCase();
  let score = 0;
  for (const kw of HIGH_WEIGHT_KEYWORDS) if (haystack.includes(kw)) score += 3;
  for (const kw of MEDIUM_WEIGHT_KEYWORDS) if (haystack.includes(kw)) score += 1;
  return score;
}

export function extractLinks($: cheerio.CheerioAPI, baseUrl: string): RankedLink[] {
  const baseOrigin = new URL(baseUrl).origin;
  const seen = new Set<string>();
  const links: RankedLink[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    let resolved: URL;
    try {
      resolved = new URL(href, baseUrl);
    } catch {
      return;
    }
    resolved.hash = "";
    if (resolved.origin !== baseOrigin) return; // same-origin only

    const normalized = resolved.toString();
    if (seen.has(normalized)) return;
    seen.add(normalized);

    const text = $(el).text().trim();
    links.push({ url: normalized, text, score: scoreLink(normalized, text) });
  });

  return links.sort((a, b) => b.score - a.score);
}

export function extractVisibleText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, svg").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

async function loadRobotsRules(seedUrl: string, options: SafeFetchOptions) {
  try {
    const robotsUrl = new URL("/robots.txt", seedUrl).toString();
    const res = await safeFetch(robotsUrl, options);
    return robotsParser(robotsUrl, res.body);
  } catch {
    return null; // no robots.txt, or it's unreachable — treat as "no restrictions" per common convention
  }
}

/**
 * Depth-2 crawl: fetch the seed page, rank its same-origin links by
 * relevance to hiring/culture content, then fetch the top-ranked pages.
 * Per-page failures are recorded and skipped, never fatal to the crawl.
 */
export async function crawlCompanySite(seedUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const requestDelayMs = options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS;

  const pagesUsed: CrawledPage[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const robotsRules = await loadRobotsRules(seedUrl, options);

  const isAllowedByRobots = (url: string): boolean => {
    if (!robotsRules) return true;
    const allowed = robotsRules.isAllowed(url, "TraoInterviewPrepBot");
    return allowed !== false;
  };

  const visited = new Set<string>();
  const queue: string[] = [seedUrl];
  let seedProcessed = false;

  while (queue.length > 0 && pagesUsed.length < maxPages) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (!isAllowedByRobots(current)) {
      skipped.push({ url: current, reason: "disallowed by robots.txt" });
      continue;
    }

    try {
      const result = await safeFetch(current, options);
      const $ = cheerio.load(result.body);
      const text = extractVisibleText($);
      pagesUsed.push({ url: result.finalUrl, text });

      if (!seedProcessed) {
        seedProcessed = true;
        const ranked = extractLinks($, result.finalUrl);
        for (const link of ranked.slice(0, Math.max(0, maxPages - 1))) {
          if (!visited.has(link.url)) queue.push(link.url);
        }
      }
    } catch (err) {
      skipped.push({ url: current, reason: (err as Error).message });
    }

    if (requestDelayMs > 0 && queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
    }
  }

  return { pagesUsed, skipped };
}

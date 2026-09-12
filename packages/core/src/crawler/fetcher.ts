import { URL } from "node:url";
import { assertUrlIsSafe, type SsrfGuardOptions } from "./ssrfGuard.js";

export interface SafeFetchOptions extends SsrfGuardOptions {
  maxRedirects?: number;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeFetchResult {
  finalUrl: string;
  contentType: string;
  body: string;
}

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 2_000_000;
const ALLOWED_CONTENT_TYPES = ["text/html", "text/plain"];
const USER_AGENT = "TraoInterviewPrepBot/1.0 (+research crawler for interview-prep-kit assessment)";

/**
 * Fetches a URL with SSRF protection, a content-type/size allowlist, a
 * timeout, and manual redirect handling — every redirect target is
 * re-validated by the SSRF guard from scratch before being followed,
 * closing the classic redirect-based SSRF bypass.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let currentUrl = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validatedUrl = await assertUrlIsSafe(currentUrl, options);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(validatedUrl.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
    } catch (err) {
      clearTimeout(timeout);
      throw new Error(`Request failed for ${currentUrl}: ${(err as Error).message}`);
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      clearTimeout(timeout);
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect with no Location header from ${currentUrl}`);
      currentUrl = new URL(location, validatedUrl).toString();
      continue; // next loop iteration re-validates this new target from scratch
    }

    if (!res.ok) {
      clearTimeout(timeout);
      throw new Error(`HTTP ${res.status} fetching ${currentUrl}`);
    }

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      clearTimeout(timeout);
      throw new Error(`Rejected content-type "${contentType}" for ${currentUrl}`);
    }

    const declaredLength = res.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > maxBytes) {
      clearTimeout(timeout);
      throw new Error(`Content too large (${declaredLength} bytes) for ${currentUrl}`);
    }

    const body = await readBodyWithCap(res, maxBytes, controller);
    clearTimeout(timeout);
    return { finalUrl: currentUrl, contentType, body };
  }

  throw new Error(`Too many redirects fetching ${rawUrl}`);
}

async function readBodyWithCap(res: Response, maxBytes: number, controller: AbortController): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    return res.text();
  }

  let received = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      controller.abort();
      throw new Error(`Content exceeded ${maxBytes}-byte cap while streaming`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

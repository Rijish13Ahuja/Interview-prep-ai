import type { z } from "zod";

/**
 * Hard ceiling on total calls per logical pipeline step, covering any
 * combination of transient-failure retry and schema-repair attempts.
 * This is an absolute cap, not "retry twice AND repair twice" stacked —
 * whichever failure types occur along the way share this one budget.
 */
export const MAX_ATTEMPTS_PER_STEP = 3;
const TRANSIENT_RETRY_BACKOFF_MS = 1500;

export type LLMErrorKind = "retryable" | "non-retryable";

export class LLMTransportError extends Error {
  kind: LLMErrorKind;
  status?: number;

  constructor(kind: LLMErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LLMTransportError";
    this.kind = kind;
    this.status = status;
  }
}

/** A transport sends a prompt string and returns the raw text response (expected to contain JSON). */
export type LLMTransport = (prompt: string) => Promise<string>;

export type StepResult<T> =
  | { ok: true; attempts: number; data: T }
  | { ok: false; attempts: number; reason: "transport" | "schema"; message: string };

/** The interface every pipeline step depends on — never a concrete provider SDK. */
export type LLMCaller = <T>(prompt: string, schema: z.ZodType<T>) => Promise<StepResult<T>>;

function tryParseJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  // Models sometimes wrap JSON in markdown fences despite instructions — strip defensively.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (err) {
    return { ok: false, error: `Response was not valid JSON: ${(err as Error).message}` };
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

function buildRepairPrompt(originalPrompt: string, rawResponse: string, problem: string): string {
  return `Your previous response did not satisfy the required format. Problem: ${problem}

Your previous response was:
${rawResponse}

Re-read the original instructions below and return ONLY corrected JSON that satisfies them exactly.

--- ORIGINAL INSTRUCTIONS ---
${originalPrompt}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a single logical generation step against a transport, enforcing the
 * MAX_ATTEMPTS_PER_STEP cap across transient retries and schema-repair
 * attempts combined. Never throws — callers get a discriminated result.
 */
export async function generateStructured<T>(
  transport: LLMTransport,
  options: { prompt: string; schema: z.ZodType<T> }
): Promise<StepResult<T>> {
  let currentPrompt = options.prompt;
  let lastMessage = "unknown error";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_STEP; attempt++) {
    let raw: string;
    try {
      raw = await transport(currentPrompt);
    } catch (err) {
      const isRetryable = err instanceof LLMTransportError ? err.kind === "retryable" : true;
      lastMessage = err instanceof Error ? err.message : String(err);

      if (!isRetryable || attempt === MAX_ATTEMPTS_PER_STEP) {
        return { ok: false, attempts: attempt, reason: "transport", message: lastMessage };
      }
      await sleep(TRANSIENT_RETRY_BACKOFF_MS);
      continue; // retry with the same prompt — this was a transport-level failure, not a content problem
    }

    const parsed = tryParseJson(raw);
    if (parsed.ok) {
      const validated = options.schema.safeParse(parsed.value);
      if (validated.success) {
        return { ok: true, attempts: attempt, data: validated.data };
      }
      lastMessage = formatZodError(validated.error);
    } else {
      lastMessage = parsed.error;
    }

    if (attempt === MAX_ATTEMPTS_PER_STEP) {
      return { ok: false, attempts: attempt, reason: "schema", message: lastMessage };
    }
    currentPrompt = buildRepairPrompt(options.prompt, raw, lastMessage);
  }

  return { ok: false, attempts: MAX_ATTEMPTS_PER_STEP, reason: "schema", message: lastMessage };
}

export function createLLMCaller(transport: LLMTransport): LLMCaller {
  return (prompt, schema) => generateStructured(transport, { prompt, schema });
}

export interface GeminiTransportConfig {
  apiKey: string;
  model?: string;
  /** Override for testing against a local mock server; defaults to the real Gemini endpoint. */
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 30000;


async function describeGeminiErrorBody(res: Response, status: number): Promise<string> {
  try {
    const json: any = await res.json();
    const err = json?.error;
    if (!err) return `HTTP ${status}`;

    const details: any[] = Array.isArray(err.details) ? err.details : [];
    const retryInfo = details.find((d) => typeof d?.["@type"] === "string" && d["@type"].includes("RetryInfo"));
    const quotaFailure = details.find((d) => typeof d?.["@type"] === "string" && d["@type"].includes("QuotaFailure"));
    const quotaText = quotaFailure?.violations
      ?.map((v: any) => [v.subject, v.description].filter(Boolean).join(": "))
      .filter(Boolean)
      .join("; ");

    const parts = [`HTTP ${status}`, err.status, err.message];
    if (quotaText) parts.push(`quota: ${quotaText}`);
    if (retryInfo?.retryDelay) parts.push(`retryDelay: ${retryInfo.retryDelay}`);
    return parts.filter(Boolean).join(" — ");
  } catch {
    return `HTTP ${status}`;
  }
}

export function createGeminiTransport(config: GeminiTransportConfig): LLMTransport {
  if (!config.apiKey) {
    throw new Error("Gemini API key is required (set GEMINI_API_KEY)");
  }
  const model = config.model?.trim() || DEFAULT_GEMINI_MODEL;
  const baseUrl = config.baseUrl?.trim() || DEFAULT_GEMINI_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (prompt: string) => {
    const url = `${baseUrl}/models/${model}:generateContent?key=${config.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LLMTransportError("retryable", `Network error calling LLM provider: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429 || res.status >= 500) {
      const detail = await describeGeminiErrorBody(res, res.status);
      if (res.status === 429) console.error(`[gemini-transport] 429 detail: ${detail}`);
      throw new LLMTransportError("retryable", `LLM provider transient failure: ${detail}`, res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new LLMTransportError("non-retryable", `LLM provider auth failure: HTTP ${res.status}`, res.status);
    }
    if (!res.ok) {
      throw new LLMTransportError("non-retryable", `LLM provider request failure: HTTP ${res.status}`, res.status);
    }

    const json: any = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      throw new LLMTransportError("non-retryable", "LLM provider response missing text content");
    }
    return text;
  };
}


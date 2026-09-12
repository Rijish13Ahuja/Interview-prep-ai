import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured, LLMTransportError, type LLMTransport } from "../src/llm/provider.js";

const schema = z.object({ value: z.string() });

describe("generateStructured — hard 3-attempt cap per logical step", () => {
  it("succeeds on the first attempt", async () => {
    const transport: LLMTransport = vi.fn().mockResolvedValue(JSON.stringify({ value: "ok" }));
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result).toEqual({ ok: true, attempts: 1, data: { value: "ok" } });
  });

  it("fails immediately on a non-retryable error, without retrying", async () => {
    const transport: LLMTransport = vi.fn().mockRejectedValue(new LLMTransportError("non-retryable", "bad key"));
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.reason).toBe("transport");
    }
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("retries once on a transient failure and succeeds", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new LLMTransportError("retryable", "rate limited"))
      .mockResolvedValueOnce(JSON.stringify({ value: "ok" }));
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result).toEqual({ ok: true, attempts: 2, data: { value: "ok" } });
    expect(transport).toHaveBeenCalledTimes(2);
  }, 10000);

  it("never exceeds the 3-call cap even with repeated transient failures", async () => {
    const transport = vi.fn().mockRejectedValue(new LLMTransportError("retryable", "still down"));
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.attempts).toBe(3);
    expect(transport).toHaveBeenCalledTimes(3);
  }, 10000);

  it("repairs invalid JSON on a second attempt", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce(JSON.stringify({ value: "fixed" }));
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result).toEqual({ ok: true, attempts: 2, data: { value: "fixed" } });
  });

  it("repairs a schema-invalid (but syntactically valid) response on a second attempt", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ wrong: "shape" }))
      .mockResolvedValueOnce(JSON.stringify({ value: "fixed" }));
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result).toEqual({ ok: true, attempts: 2, data: { value: "fixed" } });
  });

  it("gives up after the cap when the response never becomes valid, capped at 3 calls", async () => {
    const transport = vi.fn().mockResolvedValue("still not json");
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.reason).toBe("schema");
    }
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("never mixes more than 3 total calls even across a transient retry AND a schema repair", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(new LLMTransportError("retryable", "rate limited")) // attempt 1: transient
      .mockResolvedValueOnce("not valid json") // attempt 2: schema problem
      .mockResolvedValueOnce(JSON.stringify({ value: "should not be reached if cap were 2" }));
    const result = await generateStructured(transport, { prompt: "p", schema });
    // attempt 3 is the repair call and it succeeds — total calls must be exactly 3, never more
    expect(transport).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(true);
  }, 10000);

  it("strips markdown code fences before parsing", async () => {
    const transport = vi.fn().mockResolvedValue("```json\n" + JSON.stringify({ value: "ok" }) + "\n```");
    const result = await generateStructured(transport, { prompt: "p", schema });
    expect(result).toEqual({ ok: true, attempts: 1, data: { value: "ok" } });
  });
});

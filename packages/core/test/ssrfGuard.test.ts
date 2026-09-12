import { describe, expect, it } from "vitest";
import { assertUrlIsSafe } from "../src/crawler/ssrfGuard.js";

// IP literals in the URL resolve without a real DNS query (Node's dns.lookup
// short-circuits for IP addresses), so these tests need no network access.

describe("assertUrlIsSafe", () => {
  it("blocks loopback (127.0.0.1) in production mode", async () => {
    await expect(assertUrlIsSafe("http://127.0.0.1:8099/acme/", { allowLoopback: false })).rejects.toThrow(/loopback/i);
  });

  it("allows loopback only when explicitly enabled for evaluation", async () => {
    const url = await assertUrlIsSafe("http://127.0.0.1:8099/acme/", { allowLoopback: true });
    expect(url.hostname).toBe("127.0.0.1");
  });

  it("allows localhost hostname only when loopback is explicitly enabled", async () => {
    const url = await assertUrlIsSafe("http://localhost:8099/acme/", { allowLoopback: true });
    expect(url.hostname).toBe("localhost");
  });

  it("blocks localhost hostname in production mode", async () => {
    await expect(assertUrlIsSafe("http://localhost:8099/acme/", { allowLoopback: false })).rejects.toThrow(/loopback/i);
  });

  it("blocks RFC1918 private addresses even when loopback is allowed", async () => {
    await expect(assertUrlIsSafe("http://10.0.0.5/", { allowLoopback: true })).rejects.toThrow(/private/i);
    await expect(assertUrlIsSafe("http://192.168.1.1/", { allowLoopback: true })).rejects.toThrow(/private/i);
    await expect(assertUrlIsSafe("http://172.16.0.1/", { allowLoopback: true })).rejects.toThrow(/private/i);
  });

  it("blocks link-local addresses", async () => {
    await expect(assertUrlIsSafe("http://169.254.1.1/", { allowLoopback: false })).rejects.toThrow(/private|link-local/i);
  });

  it("blocks IPv6 loopback (::1) unless loopback is explicitly enabled", async () => {
    await expect(assertUrlIsSafe("http://[::1]:8099/", { allowLoopback: false })).rejects.toThrow(/loopback/i);
    const url = await assertUrlIsSafe("http://[::1]:8099/", { allowLoopback: true });
    expect(url.hostname).toBe("[::1]");
  });

  it("rejects unsupported protocols", async () => {
    await expect(assertUrlIsSafe("ftp://example.com/", { allowLoopback: false })).rejects.toThrow(/protocol/i);
  });

  it("rejects a malformed URL", async () => {
    await expect(assertUrlIsSafe("not a url", { allowLoopback: false })).rejects.toThrow(/invalid url/i);
  });

  it("allows a plausible public IP address", async () => {
    const url = await assertUrlIsSafe("http://93.184.216.34/", { allowLoopback: false });
    expect(url.hostname).toBe("93.184.216.34");
  });
});

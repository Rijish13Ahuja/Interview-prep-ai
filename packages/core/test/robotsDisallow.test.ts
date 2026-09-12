import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlCompanySite } from "../src/crawler/crawler.js";

/**
 * Verifies the actual behavioral restriction, not just that robots.txt is
 * fetched: a real Disallow rule for one path must cause the crawler to
 * skip fetching it, while an allowed path on the same site is still
 * crawled normally.
 */

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /admin-secret\n");
      return;
    }
    if (req.url === "/" || req.url === "") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body>
        <a href="/careers">Careers</a>
        <a href="/admin-secret">Admin</a>
      </body></html>`);
      return;
    }
    if (req.url === "/careers") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body><p>${"We are hiring great engineers. ".repeat(10)}</p></body></html>`);
      return;
    }
    if (req.url === "/admin-secret") {
      // If the crawler ever reaches this, the robots.txt Disallow rule wasn't honored.
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>This path is disallowed by robots.txt and must never be fetched.</body></html>");
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("failed to bind mock server");
  baseUrl = `http://127.0.0.1:${addr.port}/`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("crawlCompanySite — robots.txt Disallow is behaviorally enforced", () => {
  it("never fetches a path disallowed by robots.txt, while still crawling allowed paths", async () => {
    const result = await crawlCompanySite(baseUrl, { allowLoopback: true, requestDelayMs: 0 });

    const fetchedUrls = result.pagesUsed.map((p) => p.url);
    expect(fetchedUrls.some((u) => u.includes("/careers"))).toBe(true);
    expect(fetchedUrls.some((u) => u.includes("/admin-secret"))).toBe(false);

    const skippedForRobots = result.skipped.find((s) => s.url.includes("/admin-secret"));
    expect(skippedForRobots).toBeDefined();
    expect(skippedForRobots?.reason).toMatch(/robots/i);
  });
});

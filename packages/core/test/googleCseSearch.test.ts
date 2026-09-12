import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoogleCseSearch } from "../src/research/googleCseSearch.js";
import { researchPublicDiscussion } from "../src/research/discussionSearch.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "", "http://localhost");
    if (url.searchParams.get("q")?.includes("fails")) {
      res.writeHead(500);
      res.end("boom");
      return;
    }
    if (url.searchParams.get("q")?.includes("nothing")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ items: [] }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        items: [
          { title: "Acme interview process — Blind", link: "https://example.com/acme-interview", snippet: "Take-home then system design." },
        ],
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("failed to bind mock CSE server");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("createGoogleCseSearch (real HTTP against a local mock)", () => {
  it("returns parsed results on success", async () => {
    const search = createGoogleCseSearch({ apiKey: "k", cx: "c", baseUrl });
    const results = await search.search("acme interview process");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/acme-interview");
  });

  it("returns an empty array when the API returns no items", async () => {
    const search = createGoogleCseSearch({ apiKey: "k", cx: "c", baseUrl });
    const results = await search.search("nothing to find here");
    expect(results).toEqual([]);
  });

  it("throws on a non-2xx response", async () => {
    const search = createGoogleCseSearch({ apiKey: "k", cx: "c", baseUrl });
    await expect(search.search("this fails")).rejects.toThrow();
  });
});

describe("researchPublicDiscussion with a real (mocked-server) CSE provider", () => {
  it("reports 'found' when the provider returns results", async () => {
    const search = createGoogleCseSearch({ apiKey: "k", cx: "c", baseUrl });
    const result = await researchPublicDiscussion("Acme", search);
    expect(result.status).toBe("found");
    expect(result.results).toHaveLength(1);
  });

  it("reports 'search_failed' (not a thrown error) when the provider errors — never blocks the kit", async () => {
    const search = createGoogleCseSearch({ apiKey: "k", cx: "c", baseUrl: `${baseUrl}` });
    // force the failing branch via a query the mock server recognizes
    const failingSearch = { search: () => search.search("this fails") };
    const result = await researchPublicDiscussion("Acme", failingSearch);
    expect(result.status).toBe("search_failed");
  });
});

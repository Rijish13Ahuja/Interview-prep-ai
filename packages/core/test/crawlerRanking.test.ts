import { describe, expect, it } from "vitest";
import * as cheerio from "cheerio";
import { extractLinks, extractVisibleText, scoreLink } from "../src/crawler/crawler.js";

describe("scoreLink", () => {
  it("ranks a careers link above a generic nav link", () => {
    expect(scoreLink("/careers", "Careers")).toBeGreaterThan(scoreLink("/pricing", "Pricing"));
  });

  it("ranks a buried hiring/handbook path highly even without an obvious anchor text", () => {
    expect(scoreLink("/handbook/hiring-process", "Learn more")).toBeGreaterThan(scoreLink("/legal/terms", "Terms"));
  });

  it("gives some weight to culture/about/blog pages, less than direct careers pages", () => {
    const careers = scoreLink("/careers", "Careers");
    const culture = scoreLink("/about/culture", "Our Culture");
    const nav = scoreLink("/contact", "Contact");
    expect(careers).toBeGreaterThan(culture);
    expect(culture).toBeGreaterThan(nav);
  });
});

describe("extractLinks", () => {
  const html = `
    <html><body>
      <nav>
        <a href="/pricing">Pricing</a>
        <a href="/careers">Careers</a>
        <a href="https://external-site.com/careers">External Careers</a>
        <a href="/about#team">About</a>
        <a href="/about#team">Duplicate fragment link</a>
        <a href="mailto:hi@acme.com">Email us</a>
      </nav>
    </body></html>`;

  it("resolves relative links against the base URL", () => {
    const $ = cheerio.load(html);
    const links = extractLinks($, "https://acme.example/");
    expect(links.some((l) => l.url === "https://acme.example/careers")).toBe(true);
  });

  it("excludes cross-origin links", () => {
    const $ = cheerio.load(html);
    const links = extractLinks($, "https://acme.example/");
    expect(links.some((l) => l.url.includes("external-site.com"))).toBe(false);
  });

  it("strips fragments and dedupes", () => {
    const $ = cheerio.load(html);
    const links = extractLinks($, "https://acme.example/");
    const aboutLinks = links.filter((l) => l.url === "https://acme.example/about");
    expect(aboutLinks).toHaveLength(1);
  });

  it("ranks careers above pricing in the sorted output", () => {
    const $ = cheerio.load(html);
    const links = extractLinks($, "https://acme.example/");
    const careersIndex = links.findIndex((l) => l.url.endsWith("/careers"));
    const pricingIndex = links.findIndex((l) => l.url.endsWith("/pricing"));
    expect(careersIndex).toBeLessThan(pricingIndex);
  });

  it("skips unparsable hrefs like mailto without throwing", () => {
    const $ = cheerio.load(html);
    expect(() => extractLinks($, "https://acme.example/")).not.toThrow();
  });
});

describe("extractVisibleText", () => {
  it("strips script/style content and collapses whitespace", () => {
    const html = `<html><body><script>alert('x')</script><style>.a{}</style>
      <h1>Acme   Corp</h1>\n\n<p>We build widgets.</p></body></html>`;
    const $ = cheerio.load(html);
    const text = extractVisibleText($);
    expect(text).not.toContain("alert");
    expect(text).toContain("Acme Corp");
    expect(text).toContain("We build widgets.");
  });
});

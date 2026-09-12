# AI Interview Prep Kit

Turns a job description + a company website into a structured interview preparation kit — a company brief, a role/requirement breakdown, a categorised question bank, flashcards, and a day-by-day study schedule — which the user can then edit, reorder, regenerate piece by piece, and practise against.

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js (App Router) + Tailwind CSS | Matches the brief's preferred stack. |
| Backend | Node.js + Express | Matches the brief's preferred stack. |
| Core pipeline | Framework-free TypeScript package (`packages/core`) | The generation pipeline has zero Express/Mongo/Next imports — it's called identically by the API and the batch CLI (Section 9's "same code, not a parallel implementation"), and is unit-testable without a server or database. |
| Database | MongoDB (Mongoose) | Matches the brief's preferred stack. Generated kit content is validated by the same Zod `KitSchema` before every write rather than re-declaring Appendix A a second time in Mongoose. |
| Validation | Zod | Mirrors Appendix A/B exactly; used at every LLM-call boundary and before every persistence write. |
| LLM | Google Gemini (`gemini-1.5-flash` by default) via a plain `fetch` call to the REST API | Genuine ongoing free tier, structured/JSON-mode output. No SDK dependency — keeps the provider abstraction trivial to read, test, and swap. |
| Public discussion research | Google Programmable Search Engine (Custom Search JSON API) | Free tier, legitimate API (not scraping Glassdoor/Blind, which actively block automated access). **Optional** — see below. |
| Crawling | Native `fetch` + `cheerio` + `robots-parser` | No headless browser needed for static HTML; keeps the crawler fast and free-tier-hosting-friendly. |
| Testing | Vitest + `supertest` | 108 tests across the monorepo, including real local-HTTP-server integration tests (not just mocks) for the crawler, LLM transport, full pipeline, and API. |

## Setup

### Prerequisites
- Node.js 20+
- A MongoDB connection string (a free [MongoDB Atlas](https://www.mongodb.com/atlas) cluster works)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/) (free tier)

### Install
```bash
npm install
```
This installs every workspace (`packages/core`, `apps/api`, `apps/web`) from the root — npm workspaces handles the linking.

### Environment variables

There are **two separate env files** — this is a deliberate consequence of how each half of the app actually loads configuration, not an oversight:

1. **Repo-root `.env`** (copy from root `.env.example`) — read explicitly by both `apps/api` and `scripts/evaluate.ts` (the batch CLI), regardless of which directory each is launched from:
   - `GEMINI_API_KEY` — **required** by both.
   - `MONGODB_URI`, `SESSION_SECRET` — **required** by `apps/api` only (the batch CLI needs no database).
   - `GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX` — **optional**, read by both. Without them, the public-discussion research step is skipped and the kit honestly reports `discussion_status: "not_configured"` rather than a false "nothing found."
   - `ALLOW_LOOPBACK_URLS` — **batch-CLI-only**. The live API never reads this variable at all (see Security below) — setting it in the API's environment has no effect either way.
   - `PORT`, `CORS_ORIGIN`, `NODE_ENV` — `apps/api` only.

   See root `.env.example` for the full list with explanations.

2. **`apps/web/.env.local`** (copy from `apps/web/.env.example`) — Next.js only ever reads env files from its own project directory, and `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, so the frontend genuinely cannot read the repo-root `.env`. It needs exactly one variable:
   - `NEXT_PUBLIC_API_URL` — defaults to `http://localhost:4000` if the file is omitted entirely, which happens to match local dev's default API port. You only need to create this file if you change the API's port or point the frontend at a deployed API URL.

### Run locally
```bash
npm run dev:api    # starts the Express API on :4000, loading the repo-root .env
npm run dev:web    # in a second terminal — starts Next.js on :3000
```
Visit `http://localhost:3000`, register an account, and create a kit.

### Run the batch entry point
```bash
npm run evaluate -- --input <cases.json> --output <kits.json>
```
This is the exact mandatory command from Section 9. It needs only `GEMINI_API_KEY` (and optionally the CSE vars) from the repo-root `.env` — **no database, no running server, no frontend**. It reads the same `generateKit()` pipeline used by the API. Company URLs served locally (e.g. `http://localhost:8099/...`) work by setting `ALLOW_LOOPBACK_URLS=true` in the repo-root `.env` for this command's own run.

### Run the test suite
```bash
npm test
```

### Build / type-check everything
```bash
npm run build
```
Runs, in order: a real compile of `packages/core` (its actual build artifact — nothing else in the repo consumes it, since everything else runs the package's TypeScript source directly via `tsx`/Next.js, but this still validates it compiles cleanly), a type-check of `apps/api` (it has no separate compiled output — both `dev` and `start` run its TypeScript source via `tsx`, so a type-check is the meaningful "build" validation for it), and a production `next build` of `apps/web`.

## Architecture

```
Next.js Frontend ──HTTP (cookies)──▶ Express API ──▶ generateKit() [packages/core, framework-free]
                                          │                    ▲
                                          ▼                    │
                                       MongoDB          Batch CLI (scripts/evaluate.ts)
                                                          — calls generateKit() directly,
                                                            no DB/HTTP needed
```

`packages/core` owns: Appendix A/B schemas, the LLM provider abstraction, the crawler + SSRF guard, every generation step, coverage checking, and schedule allocation. `apps/api` owns only: auth, persistence, ownership, and translating HTTP requests into calls on that pipeline. `apps/web` owns only presentation and talks to the API exclusively over HTTP.

## Retrieval approach and sources

- **Company site**: seed fetch of the given `company_url`, same-origin link extraction, links ranked by keyword weight (`careers`/`jobs`/`hiring` weighted highest; `about`/`culture`/`blog`/`handbook` weighted lower), top-ranked pages fetched (depth 2, capped page count, `robots.txt` respected). A fixed path list is never used — this directly targets the brief's "GitLab and PostHog publish hiring info at paths we'd never have predicted" example.
- **Public interview discussion**: one Google Custom Search query per kit (`"<company>" interview process software engineer`), only when configured. Never scrapes community sites directly.
- Every source URL actually used ends up in `source.pages_used` and/or `company_brief.sources` — never fabricated.

## Sequencing — what each step is responsible for

1. **Extract requirements** (LLM) — also pulls role title/seniority/location/responsibilities in the same call. Each requirement carries an `evidence` quote; a requirement whose evidence can't be found in the JD (normalized substring match, then a token-overlap fallback for light paraphrasing) triggers **one** batched repair call for just the ungrounded items, then is dropped if still ungrounded. This is the direct guard against "nothing is invented."
2. **Crawl the company site** (deterministic) — independent of extraction; failures are recorded, never fatal.
3. **Research public discussion** (optional, one attempt, never fatal, never retried).
4. **Write the company brief** (LLM) — but only if crawled content clears a minimum length; below that, the LLM is never called at all and an honest fallback ("limited information could be retrieved...") is used instead. This is the real anti-hallucination guard, not just a prompt instruction.
5. **Generate questions, separately by category** — one call each for `technical`, `behavioural`, `system-design`, `company-fit`, with different instructions and different relevant-requirement subsets per call (never one undifferentiated prompt for every requirement).
6. **Check coverage** (deterministic set difference — must-have requirement ids not referenced by any question).
7. **Gap-fill** — at most one additional pass, batched by requirement kind, only for what's still uncovered.
8. **Generate flashcards** — one batched call for the whole kit (front/back distinct from the interview Q&A content), with a deterministic fallback (derived from question prompt/answer) if that call is exhausted.
9. **Allocate the schedule** (deterministic — see below).
10. **Validate** the assembled kit against the exact Appendix A schema before it's ever persisted or written to batch output.

## Deterministic vs. LLM

Coverage, schedule allocation, ID assignment, must/nice contradiction correction (only on an explicit textual contradiction, e.g. evidence literally says "nice to have" while the model tagged it "must"), evidence-groundedness checking, and final structure validation are all plain code — never delegated to the model, per Section 3's explicit instruction.

## Schedule allocation

Questions are sorted (must-linked first, then by difficulty) and sliced into contiguous, non-empty buckets — one per day, up to the number of days requested. If there are more days than natural content chunks (e.g. a 60-day schedule with a handful of questions), the remaining days become lower-effort "review" days that revisit already-scheduled must-have questions at decreasing frequency — schema-legal since Appendix A doesn't forbid a question id appearing on more than one day. This guarantees exactly N days, every must-have requirement scheduled somewhere, and harder/must-have material landing earlier — all verified by unit tests covering 1-day, 7-day, 30-day, and 60-day-with-few-questions cases.

## Generated / edited / pinned state

Every question and flashcard carries `origin: "ai" | "user"` and `isLocked: boolean` (both are permitted Appendix-A extensions, stripped from batch CLI output since they're meaningless for a freshly-generated kit). Editing any field locks the item; manually adding one creates it pre-locked. Regenerating a category discards only the unlocked items in that category — locked items (user-created, edited, or explicitly pinned) and every other category are left untouched. Edits are direct field-level mutations in the API — the edit endpoints never call the LLM, so "edit one field, it survives exactly as edited" is a structural guarantee, not a convention.

## Failure handling

- **Partial** (kit still produced, gaps recorded honestly): unreachable/partial company site, no hiring page found, no public discussion found, thin JD yielding few or zero requirements, one question category's generation degrading.
- **Fatal** (batch case marked `failed`): only when requirement extraction itself exhausts its retry/repair budget with no usable response at all.
- Every LLM-backed step is capped at 3 total calls (any mix of transient-failure retry and schema-repair), so a single flaky call can't cascade into a long-running or runaway request.

## Security

- SSRF: every URL's hostname is DNS-resolved and the resolved IP checked against a blocklist (loopback, RFC1918, link-local) before fetching; redirect targets are re-validated the same way on every hop. `ALLOW_LOOPBACK_URLS` is a narrow exception (loopback only, RFC1918 always still blocked) — and it's a *structural*, not just procedural, restriction: `apps/api`'s pipeline wiring (`apps/api/src/generation/deps.ts`) hardcodes loopback access off and never reads this variable at all, so only `scripts/evaluate.ts` (the batch CLI) can ever enable it. Leaving it set to `true` in the live API's environment by mistake has no effect.
- Fetched pages and the pasted JD are always framed to the LLM as data to analyze, with explicit instructions to ignore any embedded imperatives, and every LLM response is schema-validated regardless of what it contains.
- Content-type/size/timeout limits on every fetch.

## Creative feature

Not included. Given the timebox, effort went into the mandatory scope's correctness and coverage (retrieval, coverage/schedule determinism, the builder's edit-lock-regenerate model, and test coverage) rather than an additional feature — consistent with the brief's own framing that this is genuinely optional.

## Known limitations

- No real Gemini/Google-CSE traffic was exercised during development (all pipeline/API tests use fake or locally-mocked HTTP servers to stay deterministic and avoid consuming free-tier quota) — a live check of actual free-tier rate limits before heavy use is worth doing.
- Deployment: this repo is deployment-ready (see below) but hasn't been deployed to a live URL as part of this build — that requires connecting real hosting accounts.
- The public-discussion search step, when configured, makes a best-effort single query; it does not attempt multiple query phrasings or pagination.

## Deployment

- **Frontend**: any static/Node host that supports Next.js (Vercel is the simplest — zero-config for an App Router project). Set `NEXT_PUBLIC_API_URL` to the deployed API's URL.
- **API**: any Node host (Render, Railway, Fly.io). Set `GEMINI_API_KEY`, `MONGODB_URI`, `SESSION_SECRET`, and `CORS_ORIGIN` (the deployed frontend's origin) as environment variables — `CORS_ORIGIN` in particular should be treated as required once deployed: without it, CORS reflects any origin back with credentials enabled, which is only acceptable for local development.
- **Database**: MongoDB Atlas free tier (M0).
- The session cookie is configured for cross-origin use in production (`SameSite=None; Secure`, with `trust proxy` enabled for hosts that terminate TLS at a reverse proxy), so a separately-hosted frontend and API work out of the box once `CORS_ORIGIN`/`NEXT_PUBLIC_API_URL` are set correctly.

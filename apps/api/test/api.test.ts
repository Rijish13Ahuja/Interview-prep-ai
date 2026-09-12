import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { InMemoryKitStore, InMemoryUserStore } from "../src/store/memoryStore.js";
import { buildFakePipelineDeps, buildSlowFakePipelineDeps, JD } from "./testDeps.js";

function buildTestApp() {
  return createApp({
    userStore: new InMemoryUserStore(),
    kitStore: new InMemoryKitStore(),
    sessionSecret: "test-secret",
    buildPipelineDeps: buildFakePipelineDeps,
  });
}

async function waitForReady(agent: ReturnType<typeof request.agent>, id: string, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await agent.get(`/api/kits/${id}`);
    if (res.body.status === "ok" || res.body.status === "failed") return res.body;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Timed out waiting for kit generation");
}

describe("auth", () => {
  it("registers, sets a session, and returns the user", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/auth/register").send({ email: "a@example.com", password: "password123" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe("a@example.com");
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("rejects a duplicate email registration", async () => {
    const app = buildTestApp();
    await request(app).post("/api/auth/register").send({ email: "dup@example.com", password: "password123" });
    const res = await request(app).post("/api/auth/register").send({ email: "dup@example.com", password: "password123" });
    expect(res.status).toBe(409);
  });

  it("rejects too-short passwords", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/api/auth/register").send({ email: "x@example.com", password: "short" });
    expect(res.status).toBe(400);
  });

  it("rejects login with a wrong password", async () => {
    const app = buildTestApp();
    await request(app).post("/api/auth/register").send({ email: "b@example.com", password: "password123" });
    const res = await request(app).post("/api/auth/login").send({ email: "b@example.com", password: "wrongpassword" });
    expect(res.status).toBe(401);
  });

  it("logs in with correct credentials and logs out cleanly", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email: "c@example.com", password: "password123" });
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    const logout = await agent.post("/api/auth/logout");
    expect(logout.status).toBe(204);
    const meAfter = await agent.get("/api/auth/me");
    expect(meAfter.status).toBe(401);
  });

  it("rejects unauthenticated access to protected routes with a structured 401", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/api/kits");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("kit generation and ownership", () => {
  it("creates a kit, generates it in the background, and the owner can read it", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email: "owner@example.com", password: "password123" });

    const create = await agent.post("/api/kits").send({ jd: JD, company_url: "https://acme.example", days: 5 });
    expect(create.status).toBe(202);
    expect(["pending", "generating"]).toContain(create.body.status);

    const ready = await waitForReady(agent, create.body.id);
    expect(ready.status).toBe("ok");
    expect(ready.kit.role.requirements.length).toBe(3);
    expect(ready.kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(ready.kit.schedule.days).toHaveLength(5);
  });

  it("lists only the current user's kits", async () => {
    const app = buildTestApp();
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    await agentA.post("/api/auth/register").send({ email: "usera@example.com", password: "password123" });
    await agentB.post("/api/auth/register").send({ email: "userb@example.com", password: "password123" });

    const created = await agentA.post("/api/kits").send({ jd: JD, company_url: "https://acme.example", days: 3 });
    await waitForReady(agentA, created.body.id);

    const listA = await agentA.get("/api/kits");
    expect(listA.body.kits).toHaveLength(1);

    const listB = await agentB.get("/api/kits");
    expect(listB.body.kits).toHaveLength(0);
  });

  it("returns 404 (not 403) when a user requests another user's kit — no existence leak", async () => {
    const app = buildTestApp();
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    await agentA.post("/api/auth/register").send({ email: "ownerx@example.com", password: "password123" });
    await agentB.post("/api/auth/register").send({ email: "otherx@example.com", password: "password123" });

    const created = await agentA.post("/api/kits").send({ jd: JD, company_url: "https://acme.example", days: 3 });
    const res = await agentB.get(`/api/kits/${created.body.id}`);
    expect(res.status).toBe(404);
  });

  it("rejects an empty job description with a structured 400 before touching the pipeline", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email: "thin@example.com", password: "password123" });
    const res = await agent.post("/api/kits").send({ jd: "", company_url: "https://acme.example", days: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });
});

describe("builder: edit, add, delete, reorder, regenerate", () => {
  async function createReadyKit(agent: ReturnType<typeof request.agent>) {
    await agent.post("/api/auth/register").send({ email: `u${Date.now()}${Math.random()}@example.com`, password: "password123" });
    const created = await agent.post("/api/kits").send({ jd: JD, company_url: "https://acme.example", days: 5 });
    return waitForReady(agent, created.body.id);
  }

  it("editing a question locks it and persists the exact edit", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    const kit = await createReadyKit(agent);
    const question = kit.kit.questions[0];

    const res = await agent.patch(`/api/kits/${kit.id}/questions/${question.id}`).send({ prompt: "My hand-edited question text" });
    expect(res.status).toBe(200);
    const edited = res.body.kit.questions.find((q: any) => q.id === question.id);
    expect(edited.prompt).toBe("My hand-edited question text");
    // answer_outline untouched — no merging/rewriting beyond the edited field
    expect(edited.answer_outline).toBe(question.answer_outline);
  });

  it("a manually added question survives a regeneration of its category, and unedited generated ones are replaced", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    const kit = await createReadyKit(agent);
    const technicalReq = kit.kit.role.requirements.find((r: any) => r.kind === "technical");

    const added = await agent.post(`/api/kits/${kit.id}/questions`).send({
      category: "technical",
      prompt: "Hand-written question",
      answer_outline: "Hand-written outline",
      difficulty: 3,
      requirement_ids: [technicalReq.id],
    });
    expect(added.status).toBe(201);
    const addedId = added.body.kit.questions.find((q: any) => q.prompt === "Hand-written question").id;

    const originalGeneratedTechnical = kit.kit.questions.filter((q: any) => q.category === "technical").map((q: any) => q.id);

    const regen = await agent.post(`/api/kits/${kit.id}/regenerate/questions/technical`);
    expect(regen.status).toBe(200);
    const technicalAfter = regen.body.kit.questions.filter((q: any) => q.category === "technical");

    // the hand-added question survives
    expect(technicalAfter.some((q: any) => q.id === addedId)).toBe(true);
    // the original AI-generated (never edited/pinned) technical question(s) were replaced, not kept verbatim
    const survivedOriginalIds = technicalAfter.map((q: any) => q.id).filter((id: string) => originalGeneratedTechnical.includes(id));
    expect(survivedOriginalIds).toEqual([]);
    // other categories are untouched
    const behaviouralBefore = kit.kit.questions.filter((q: any) => q.category === "behavioural").map((q: any) => q.id);
    const behaviouralAfter = regen.body.kit.questions.filter((q: any) => q.category === "behavioural").map((q: any) => q.id);
    expect(behaviouralAfter).toEqual(behaviouralBefore);
  });

  it("deleting a question removes it from the schedule too, keeping references valid", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    const kit = await createReadyKit(agent);
    const scheduledId = kit.kit.schedule.days.flatMap((d: any) => d.question_ids)[0];
    expect(scheduledId).toBeDefined();

    const res = await agent.delete(`/api/kits/${kit.id}/questions/${scheduledId}`);
    expect(res.status).toBe(200);
    expect(res.body.kit.questions.some((q: any) => q.id === scheduledId)).toBe(false);
    const stillReferenced = res.body.kit.schedule.days.some((d: any) => d.question_ids.includes(scheduledId));
    expect(stillReferenced).toBe(false);
  });

  it("reorders questions", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    const kit = await createReadyKit(agent);
    const ids = kit.kit.questions.map((q: any) => q.id);
    const reversed = [...ids].reverse();

    const res = await agent.patch(`/api/kits/${kit.id}/questions/reorder`).send({ orderedIds: reversed });
    expect(res.status).toBe(200);
    expect(res.body.kit.questions.map((q: any) => q.id)).toEqual(reversed);
  });

  it("editing the company brief locks it, and regeneration is blocked until forced", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    const kit = await createReadyKit(agent);

    const edit = await agent.patch(`/api/kits/${kit.id}/company-brief`).send({ summary: "My manually written summary." });
    expect(edit.status).toBe(200);
    expect(edit.body.companyBriefLocked).toBe(true);

    const blocked = await agent.post(`/api/kits/${kit.id}/regenerate/company-brief`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("COMPANY_BRIEF_LOCKED");

    const forced = await agent.post(`/api/kits/${kit.id}/regenerate/company-brief`).send({ force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.companyBriefLocked).toBe(false);
  });

  it("adds and deletes a flashcard", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    const kit = await createReadyKit(agent);

    const add = await agent.post(`/api/kits/${kit.id}/flashcards`).send({ front: "Q", back: "A", requirement_ids: [] });
    expect(add.status).toBe(201);
    const cardId = add.body.kit.flashcards.find((f: any) => f.front === "Q").id;

    const del = await agent.delete(`/api/kits/${kit.id}/flashcards/${cardId}`);
    expect(del.status).toBe(200);
    expect(del.body.kit.flashcards.some((f: any) => f.id === cardId)).toBe(false);
  });

  it("records practice confidence for a flashcard", async () => {
    const app = buildTestApp();
    const agent = request.agent(app);
    const kit = await createReadyKit(agent);
    const cardId = kit.kit.flashcards[0]?.id;
    expect(cardId).toBeDefined();

    const res = await agent.patch(`/api/kits/${kit.id}/practice`).send({ cardId, confidence: 1 });
    expect(res.status).toBe(200);
    expect(res.body.practice.confidenceByCardId[cardId]).toBe(1);
    expect(res.body.practice.coveredCardIds).toContain(cardId);
  });

  it("rejects edits while a kit is still generating (409) rather than corrupting state", async () => {
    const app = createApp({
      userStore: new InMemoryUserStore(),
      kitStore: new InMemoryKitStore(),
      sessionSecret: "test-secret",
      buildPipelineDeps: () => buildSlowFakePipelineDeps(200),
    });
    const agent = request.agent(app);
    await agent.post("/api/auth/register").send({ email: `pending${Date.now()}@example.com`, password: "password123" });
    const created = await agent.post("/api/kits").send({ jd: JD, company_url: "https://acme.example", days: 5 });
    expect(["pending", "generating"]).toContain(created.body.status);

    const res = await agent.patch(`/api/kits/${created.body.id}/company-brief`).send({ summary: "too early" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("KIT_NOT_READY");
  });
});

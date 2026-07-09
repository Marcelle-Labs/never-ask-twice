import { describe, expect, it } from "vitest";

import { createApp } from "../apps/api/src/server.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

function parseVisitorCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/nat_visitor=([^;]+)/);
  return match ? match[1] : null;
}

function makeApp() {
  const store = new InMemoryMemoryStore();
  const qwen = new FakeQwenClient();
  const memory = new MemoryService(store, qwen);
  const app = createApp({ store, memory, qwen });
  return { app, store, memory, qwen };
}

describe("recall-session-validation", () => {
  it("GET /recall with non-existent sessionId returns empty bundle, not Acme facts", async () => {
    const { app } = makeApp();

    // First request to get a visitor cookie (seeds Acme facts for that tenant)
    const chatRes = await app.fetch(new Request("http://localhost/chat"));
    const cookie = parseVisitorCookie(chatRes.headers.get("set-cookie"));
    expect(cookie).toBeTruthy();

    // Recall with a non-existent session — must return empty, not the Acme fact set
    const recallRes = await app.fetch(
      new Request("http://localhost/recall?sessionId=does-not-exist-abc123", {
        headers: { Cookie: `nat_visitor=${cookie}` },
      }),
    );
    expect(recallRes.status).toBe(200);
    const body = await recallRes.json();
    expect(body.ok).toBe(true);
    expect(body.bundle).toHaveLength(0);
    expect(body.usedTokens).toBe(0);
  });

  it("GET /recall with valid sessionId returns facts for that session's tenant", async () => {
    const { app, store } = makeApp();

    // Load /chat to seed facts and get a session
    const chatRes = await app.fetch(new Request("http://localhost/chat"));
    const cookie = parseVisitorCookie(chatRes.headers.get("set-cookie"))!;
    const html = await chatRes.text();
    const sessionMatch = html.match(/const sessionId = "([^"]+)"/);
    expect(sessionMatch).toBeTruthy();
    const sessionId = sessionMatch![1];

    // Recall with the valid session
    const recallRes = await app.fetch(
      new Request(`http://localhost/recall?sessionId=${sessionId}`, {
        headers: { Cookie: `nat_visitor=${cookie}` },
      }),
    );
    expect(recallRes.status).toBe(200);
    const body = await recallRes.json();
    expect(body.ok).toBe(true);
    expect(body.bundle.length).toBeGreaterThan(0);
    // Should contain Acme fixture facts (semantic kind)
    const semanticItems = body.bundle.filter((item: { kind: string }) => item.kind === "semantic");
    expect(semanticItems.length).toBeGreaterThan(0);
  });

  it("GET /recall with sessionId from a different tenant returns empty bundle", async () => {
    const { app } = makeApp();

    // Visitor A loads /chat
    const chatResA = await app.fetch(new Request("http://localhost/chat"));
    const cookieA = parseVisitorCookie(chatResA.headers.get("set-cookie"))!;
    const htmlA = await chatResA.text();
    const sessionMatchA = htmlA.match(/const sessionId = "([^"]+)"/);
    const sessionIdA = sessionMatchA![1];

    // Visitor B loads /chat
    const chatResB = await app.fetch(new Request("http://localhost/chat"));
    const cookieB = parseVisitorCookie(chatResB.headers.get("set-cookie"))!;

    // Visitor B tries to recall visitor A's session
    const recallRes = await app.fetch(
      new Request(`http://localhost/recall?sessionId=${sessionIdA}`, {
        headers: { Cookie: `nat_visitor=${cookieB}` },
      }),
    );
    expect(recallRes.status).toBe(200);
    const body = await recallRes.json();
    expect(body.ok).toBe(true);
    expect(body.bundle).toHaveLength(0);
  });

  it("GET /recall without sessionId returns empty bundle", async () => {
    const { app } = makeApp();

    const recallRes = await app.fetch(new Request("http://localhost/recall"));
    expect(recallRes.status).toBe(200);
    const body = await recallRes.json();
    expect(body.ok).toBe(true);
    expect(body.bundle).toHaveLength(0);
  });
});

describe("seedVisitorFacts-concurrency-safety", () => {
  it("does not duplicate facts when called twice for the same tenant (check-then-act guard)", async () => {
    const { app, store, qwen } = makeApp();

    // Simulate two concurrent first-loads: both get the same cookie
    const cookie = "shared-cookie-id";

    // Both requests hit /chat with the same cookie
    await app.fetch(
      new Request("http://localhost/chat", {
        headers: { Cookie: `nat_visitor=${cookie}` },
      }),
    );
    await app.fetch(
      new Request("http://localhost/chat", {
        headers: { Cookie: `nat_visitor=${cookie}` },
      }),
    );

    const acct = `visitor_${cookie}`;
    const facts = await store.currentFacts(acct, acct, new Date());
    // Must still be exactly 4 — no duplicates
    expect(facts).toHaveLength(4);
    const predicates = facts.map((f) => f.predicate).sort();
    expect(predicates).toEqual(
      ["escalation_contact", "integration", "product_config", "sla_tier"].sort(),
    );
  });
});

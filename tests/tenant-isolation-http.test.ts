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

describe("tenant-isolation-http", () => {
  it("assigns different tenants to different visitors", async () => {
    const { app, store } = makeApp();

    const res1 = await app.fetch(new Request("http://localhost/chat"));
    expect(res1.status).toBe(200);
    const visitorId1 = parseVisitorCookie(res1.headers.get("set-cookie"));
    expect(visitorId1).toBeTruthy();

    const res2 = await app.fetch(new Request("http://localhost/chat"));
    expect(res2.status).toBe(200);
    const visitorId2 = parseVisitorCookie(res2.headers.get("set-cookie"));
    expect(visitorId2).toBeTruthy();

    expect(visitorId1).not.toBe(visitorId2);

    const acct1 = `visitor_${visitorId1}`;
    const acct2 = `visitor_${visitorId2}`;
    const facts1 = await store.currentFacts(acct1, acct1, new Date());
    const facts2 = await store.currentFacts(acct2, acct2, new Date());

    expect(facts1).toHaveLength(4);
    expect(facts2).toHaveLength(4);
    expect(facts1.every((f) => f.accountId === acct1)).toBe(true);
    expect(facts2.every((f) => f.accountId === acct2)).toBe(true);
  });

  it("retains facts on refresh without double-seeding", async () => {
    const { app, store } = makeApp();

    const res1 = await app.fetch(new Request("http://localhost/chat"));
    const visitorId = parseVisitorCookie(res1.headers.get("set-cookie"))!;
    const acct = `visitor_${visitorId}`;

    const res2 = await app.fetch(
      new Request("http://localhost/chat", {
        headers: { Cookie: `nat_visitor=${visitorId}` },
      }),
    );
    expect(res2.status).toBe(200);

    const facts = await store.currentFacts(acct, acct, new Date());
    expect(facts).toHaveLength(4);
  });

  it("does not set a new cookie when one already exists", async () => {
    const { app } = makeApp();

    const res = await app.fetch(
      new Request("http://localhost/chat", {
        headers: { Cookie: "nat_visitor=existing-id" },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("clears working facts on session close", async () => {
    const { app, store, memory } = makeApp();

    const res = await app.fetch(new Request("http://localhost/chat"));
    const visitorId = parseVisitorCookie(res.headers.get("set-cookie"))!;
    const acct = `visitor_${visitorId}`;

    const html = await res.text();
    const sessionMatch = html.match(/const sessionId = "([^"]+)"/);
    expect(sessionMatch).toBeTruthy();
    const sessionId = sessionMatch![1];

    await memory.rememberWorkingFact({
      accountId: acct,
      customerId: acct,
      sessionId,
      candidate: {
        subject: "Acme Robotics",
        predicate: "sla_tier",
        predicateClass: "contract",
        object: "gold",
        confidence: 0.9,
        metadata: {},
      },
      observedAt: new Date(),
    });

    const before = await store.currentWorkingFacts(acct, acct, sessionId);
    expect(before).toHaveLength(1);

    const closeRes = await app.fetch(
      new Request(`http://localhost/sessions/${sessionId}/close`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `nat_visitor=${visitorId}`,
        },
        body: JSON.stringify({ accountId: acct, customerId: acct }),
      }),
    );
    expect(closeRes.status).toBe(200);

    const after = await store.currentWorkingFacts(acct, acct, sessionId);
    expect(after).toHaveLength(0);
  });

  it("seeds Acme fixture facts for a fresh visitor", async () => {
    const { app, store } = makeApp();

    const res = await app.fetch(new Request("http://localhost/chat"));
    const visitorId = parseVisitorCookie(res.headers.get("set-cookie"))!;
    const acct = `visitor_${visitorId}`;

    const facts = await store.currentFacts(acct, acct, new Date());
    const predicates = facts.map((f) => f.predicate).sort();
    expect(predicates).toEqual(
      ["escalation_contact", "integration", "product_config", "sla_tier"].sort(),
    );
  });
});

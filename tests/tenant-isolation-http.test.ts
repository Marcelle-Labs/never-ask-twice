import { describe, expect, it } from "vitest";

import { createApp } from "../apps/api/src/server.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient, parseVisitorCookie, visitorTenant } from "./helpers.js";

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

    const acct1 = visitorTenant(visitorId1!);
    const acct2 = visitorTenant(visitorId2!);
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
    const acct = visitorTenant(visitorId);

    const res2 = await app.fetch(
      new Request("http://localhost/chat", {
        headers: { Cookie: `nat_visitor=${visitorId}` },
      }),
    );
    expect(res2.status).toBe(200);

    const facts = await store.currentFacts(acct, acct, new Date());
    expect(facts).toHaveLength(4);
  });

  it("does not set a new cookie when a valid one already exists", async () => {
    const { app } = makeApp();

    const first = await app.fetch(new Request("http://localhost/chat"));
    const cookie = parseVisitorCookie(first.headers.get("set-cookie"))!;

    const res = await app.fetch(
      new Request("http://localhost/chat", {
        headers: { Cookie: `nat_visitor=${cookie}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("re-mints rather than honouring a cookie this server did not sign", async () => {
    const { app } = makeApp();

    const res = await app.fetch(
      new Request("http://localhost/chat", {
        headers: { Cookie: "nat_visitor=existing-id" },
      }),
    );
    expect(res.status).toBe(200);

    // The forged value is not adopted as a tenant; a fresh signed identity is
    // issued instead, and the rejected value is never echoed back.
    const issued = parseVisitorCookie(res.headers.get("set-cookie"));
    expect(issued).toBeTruthy();
    expect(issued).not.toContain("existing-id");
  });

  it("clears working facts on session close", async () => {
    const { app, store, memory } = makeApp();

    const res = await app.fetch(new Request("http://localhost/chat"));
    const visitorId = parseVisitorCookie(res.headers.get("set-cookie"))!;
    const acct = visitorTenant(visitorId);

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
          // What the page actually sends. A write must be positively
          // same-origin, so the header is part of the flow under test.
          Origin: "http://localhost",
        },
        body: JSON.stringify({}),
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
    const acct = visitorTenant(visitorId);

    const facts = await store.currentFacts(acct, acct, new Date());
    const predicates = facts.map((f) => f.predicate).sort();
    expect(predicates).toEqual(
      ["escalation_contact", "integration", "product_config", "sla_tier"].sort(),
    );
  });

  it("scopes eval snapshot and facts dashboard to the visitor cookie", async () => {
    const { app, store } = makeApp();

    const first = await app.fetch(new Request("http://localhost/eval-snapshot"));
    const firstVisitor = parseVisitorCookie(first.headers.get("set-cookie"))!;
    const firstBody = await first.json();
    expect(firstBody.factsCount).toBe(4);

    // A visitor's tenant id is not handed back to the browser. Scoping is
    // asserted through the store instead of through a leaked identifier.
    expect(firstBody.accountId).toBeUndefined();
    expect(firstBody.customerId).toBeUndefined();

    const second = await app.fetch(new Request("http://localhost/eval-snapshot"));
    const secondVisitor = parseVisitorCookie(second.headers.get("set-cookie"))!;
    expect(secondVisitor).not.toBe(firstVisitor);

    const firstTenant = visitorTenant(firstVisitor);
    const secondTenant = visitorTenant(secondVisitor);
    expect(firstTenant).not.toBe(secondTenant);
    expect(await store.currentFacts(firstTenant, firstTenant, new Date())).toHaveLength(4);
    expect(await store.currentFacts(secondTenant, secondTenant, new Date())).toHaveLength(4);

    const facts = await app.fetch(
      new Request("http://localhost/facts", {
        headers: { Cookie: `nat_visitor=${firstVisitor}` },
      }),
    );
    expect(facts.status).toBe(200);
    expect(await facts.text()).toContain("Priya");
  });

  it("keeps the recording harness on an explicit eval fixture tenant", async () => {
    const { app, store, qwen } = makeApp();
    await qwen.embed("seed");

    const response = await app.fetch(
      new Request("http://localhost/eval-snapshot?tenant=eval-fixture"),
    );
    const body = await response.json();
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(body.accountId).toBe("acme_corp");
    expect(body.customerId).toBe("jason_99");
    expect(await store.currentFacts("acme_corp", "jason_99", new Date())).toHaveLength(0);
  });
});

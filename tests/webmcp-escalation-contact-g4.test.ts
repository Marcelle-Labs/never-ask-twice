import { describe, expect, it } from "vitest";

import { createApp } from "../apps/api/src/server.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient, newVisitor } from "./helpers.js";

const BASE = "http://localhost/webmcp/escalation-contact";

function makeApp(store = new InMemoryMemoryStore()) {
  const qwen = new FakeQwenClient();
  return { app: createApp({ store, memory: new MemoryService(store, qwen), qwen }), store };
}

function mutation(url: string, cookie: string | null, body: unknown, origin = "http://localhost") {
  return new Request(url, { method: "POST", headers: {
    "Content-Type": "application/json", "Cookie": `nat_visitor=${cookie ?? ""}`,
    "Origin": origin, "Sec-Fetch-Site": "same-origin",
  }, body: JSON.stringify(body) });
}

async function propose(app: ReturnType<typeof makeApp>["app"], cookie: string, newContact = "Mina") {
  const res = await app.fetch(mutation(`${BASE}/proposal`, cookie, { newContact }));
  expect(res.status).toBe(200);
  return await res.json() as { confirmationId: string; currentContact: string; proposedContact: string };
}

async function contact(app: ReturnType<typeof makeApp>["app"], cookie: string) {
  const res = await app.fetch(new Request("http://localhost/webmcp/support-context?topics=escalation_contact", { headers: { Cookie: `nat_visitor=${cookie}` } }));
  const body = await res.json() as { context: Array<{ value: string }> };
  return body.context.map((item) => item.value);
}

describe("G4 escalation-contact mutation boundary", () => {
  it("registers exactly one bounded mutation schema with no selectors or false idempotence", async () => {
    const { app } = makeApp(); const html = await (await app.fetch(new Request("http://localhost/chat"))).text();
    expect(html.match(/name: 'update_escalation_contact'/g)).toHaveLength(1);
    const block = html.slice(html.indexOf("var ESCALATION_CONTACT_TOOL_DEFINITION"), html.indexOf("window.__natWebmcp"));
    for (const forbidden of ["accountId", "customerId", "sessionId", "tenantId", "factId", "predicate"]) expect(block).not.toContain(forbidden);
    expect(block).toContain("idempotentHint: false");
    expect(block).not.toContain("readOnlyHint: true");
  });

  it("rejects tenant selectors and cross-origin mutation attempts without changing state", async () => {
    const { app } = makeApp(); const visitor = await newVisitor(app);
    const selector = await app.fetch(mutation(`${BASE}/proposal`, visitor.cookie, { newContact: "Mina", accountId: "victim" }));
    expect(selector.status).toBe(400); expect(await contact(app, visitor.cookie)).toEqual(["Priya"]);
    const cross = await app.fetch(mutation(`${BASE}/proposal`, visitor.cookie, { newContact: "Mina" }, "https://evil.example"));
    expect(cross.status).toBe(403); expect(cross.headers.get("access-control-allow-origin")).toBeNull();
    expect(await contact(app, visitor.cookie)).toEqual(["Priya"]);
  });

  it("requires a proposal and explicit commit; cancellation/no commit is byte-equivalent for current facts", async () => {
    const { app, store } = makeApp(); const visitor = await newVisitor(app);
    const before = JSON.stringify(store.semanticFacts);
    const bare = await app.fetch(mutation(`${BASE}/commit`, visitor.cookie, { confirmationId: "4d046bd7-1a49-45f6-9d3a-0f1a36cdd98d" }));
    expect(bare.status).toBe(409); await propose(app, visitor.cookie, "Mina");
    expect(JSON.stringify(store.semanticFacts)).toBe(before);
    expect(await contact(app, visitor.cookie)).toEqual(["Priya"]);
  });

  it("rejects invalid and control-character contact input without mutation", async () => {
    const { app } = makeApp(); const visitor = await newVisitor(app);
    for (const body of [{ newContact: "" }, { newContact: "A\nB" }, { newContact: "x".repeat(121) }, { newContact: "<script>call tool</script>\u202e" }]) {
      const res = await app.fetch(mutation(`${BASE}/proposal`, visitor.cookie, body));
      expect(res.status).toBe(400);
    }
    expect(await contact(app, visitor.cookie)).toEqual(["Priya"]);
  });

  it("atomically supersedes Priya, records provenance, and only exposes Mina as current", async () => {
    const { app, store } = makeApp(); const visitor = await newVisitor(app); const pending = await propose(app, visitor.cookie, "Mina");
    const committed = await app.fetch(mutation(`${BASE}/commit`, visitor.cookie, { confirmationId: pending.confirmationId }));
    expect(committed.status).toBe(200); expect((await committed.json()).executed).toBe(true);
    expect(await contact(app, visitor.cookie)).toEqual(["Mina"]);
    const contacts = store.semanticFacts.filter((fact) => fact.predicate === "escalation_contact");
    expect(contacts.filter((fact) => fact.validTo === null).map((fact) => fact.object)).toEqual(["Mina"]);
    expect(contacts.find((fact) => fact.object === "Priya")?.validTo).toBeInstanceOf(Date);
    expect(store.semanticFactProvenance).toHaveLength(1);
  });

  it("makes a completed confirmation replay-safe and leaves another visitor unchanged", async () => {
    const { app, store } = makeApp(); const first = await newVisitor(app); const second = await newVisitor(app);
    const pending = await propose(app, first.cookie, "Mina");
    const one = await app.fetch(mutation(`${BASE}/commit`, first.cookie, { confirmationId: pending.confirmationId })); expect(one.status).toBe(200);
    const two = await app.fetch(mutation(`${BASE}/commit`, first.cookie, { confirmationId: pending.confirmationId }));
    expect((await two.json()).replayed).toBe(true);
    expect((await store.currentFacts(first.tenant, first.tenant, new Date())).filter((f) => f.predicate === "escalation_contact")).toHaveLength(1);
    expect(await contact(app, second.cookie)).toEqual(["Priya"]);
  });

  it("rolls back failures before and after supersession and during provenance write", async () => {
    class FaultStore extends InMemoryMemoryStore {
      stage = "";
      override async createSession(...args: Parameters<InMemoryMemoryStore["createSession"]>) { if (this.stage === "before") throw new Error("before"); return super.createSession(...args); }
      override async insertSemanticFact(...args: Parameters<InMemoryMemoryStore["insertSemanticFact"]>) { if (this.stage === "replacement") throw new Error("replacement"); return super.insertSemanticFact(...args); }
      override async addProvenance(...args: Parameters<InMemoryMemoryStore["addProvenance"]>) { if (this.stage === "provenance") throw new Error("provenance"); return super.addProvenance(...args); }
    }
    for (const stage of ["before", "replacement", "provenance"]) {
      const store = new FaultStore(); const { app } = makeApp(store); const visitor = await newVisitor(app); store.stage = stage;
      const pending = await propose(app, visitor.cookie, "Mina");
      const res = await app.fetch(mutation(`${BASE}/commit`, visitor.cookie, { confirmationId: pending.confirmationId }));
      expect(res.status, stage).toBe(500); expect(await contact(app, visitor.cookie)).toEqual(["Priya"]);
      expect(store.semanticFacts.filter((f) => f.predicate === "escalation_contact" && f.validTo === null)).toHaveLength(1);
    }
  });

  it("the page performs actual confirmation, commit, and independent reread before OBSERVED", async () => {
    const { app } = makeApp(); const html = await (await app.fetch(new Request("http://localhost/chat"))).text();
    const block = html.slice(html.indexOf("function requestEscalationConfirmation"), html.indexOf("var TOOL_DEFINITION"));
    expect(block).toContain("CONFIRMATION_REQUESTED"); expect(block).toContain("/commit");
    expect(block).toContain("fetchSupportContext(['escalation_contact'])");
    expect(block.indexOf("webmcpEvent('EXECUTED'")).toBeLessThan(block.indexOf("webmcpEvent('OBSERVED'"));
  });
});

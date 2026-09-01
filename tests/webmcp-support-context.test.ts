import { describe, expect, it } from "vitest";

import { createApp } from "../apps/api/src/server.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import type { MemoryStore } from "../src/memory/types.js";
import {
  buildSupportContext,
  parseTopics,
  MAX_CONTEXT_ITEMS,
  SUPPORT_CONTEXT_TOPICS,
} from "../apps/api/src/webmcp/supportContext.js";
import { FakeQwenClient } from "./helpers.js";

/**
 * WebMCP spike gate tests. These exist to prove the browser agent cannot select a
 * tenant, that the trace cannot claim success the server never produced, and
 * that turning WebMCP off actually removes the tool.
 */

function makeApp(storeOverride?: MemoryStore) {
  const store = storeOverride ?? new InMemoryMemoryStore();
  const qwen = new FakeQwenClient();
  const memory = new MemoryService(store, qwen);
  return { app: createApp({ store, memory, qwen }), store };
}

function parseVisitorCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/nat_visitor=([^;]+)/);
  return match ? match[1] : null;
}

async function chatHtml(query = ""): Promise<string> {
  const { app } = makeApp();
  const res = await app.fetch(new Request(`http://localhost/chat${query}`));
  expect(res.status).toBe(200);
  return res.text();
}

/** Identifiers that must never reach the model-facing surface. */
const FORBIDDEN_IDENTIFIERS = [
  "accountId",
  "customerId",
  "sessionId",
  "tenantId",
  "factId",
  "predicate",
];

/** Isolates a named block of the page script so assertions stay targeted. */
function sliceBetween(html: string, start: string, end: string): string {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return html.slice(a, b);
}

/** The model-facing input schema. */
const schemaBlock = (html: string) =>
  sliceBetween(html, "var TOOL_INPUT_SCHEMA", "// The one real network call");

/** The registered tool definition: description + schema ref + annotations. */
const definitionBlock = (html: string) =>
  sliceBetween(html, "var TOOL_DEFINITION = {", "// Diagnostic surface");

describe("webmcp registration", () => {
  // (1) registration uses the intended tool name
  it("registers exactly the tool name get_support_context", async () => {
    const html = await chatHtml();
    expect(html).toContain("name: 'get_support_context'");
    expect(html).toContain("registerTool");

    // exactly one tool is registered by this spike
    const registrations = html.match(/name: 'get_support_context'/g) ?? [];
    expect(registrations).toHaveLength(1);
    expect(html).not.toContain("update_escalation_contact");
  });

  // (6) WebMCP absence must not break the normal site
  it("feature-detects the API so non-WebMCP browsers degrade cleanly", async () => {
    const html = await chatHtml();
    expect(html).toContain("document.modelContext");
    expect(html).toContain("navigator.modelContext");
    // the guard that returns early instead of throwing
    expect(html).toContain("no modelContext on this browser; degrading cleanly");
    // the normal product surface is still rendered
    expect(html).toContain('id="chat-form"');
    expect(html).toContain('data-testid="chat-thread"');
  });

  // (7) OFF mode genuinely does not register the tool
  it("does not register the tool at all when ?webmcp=off", async () => {
    const on = await chatHtml();
    const off = await chatHtml("?webmcp=off");

    expect(on).toContain("var WEBMCP_ENABLED = true");
    expect(off).toContain("var WEBMCP_ENABLED = false");

    // The OFF page must not reach any registration call path.
    expect(off).toContain("tool NOT registered");
    expect(off).toContain("WebMCP disabled for this page");

    // and the site itself still works with WebMCP off
    expect(off).toContain('id="chat-form"');
  });

  // (2) + (4) the model-facing schema exposes topics only
  it("exposes no tenant, customer, session or fact selectors in the tool schema", async () => {
    const html = await chatHtml();
    const schema = schemaBlock(html);
    const definition = definitionBlock(html);

    // Neither the schema nor the surrounding definition may name a tenant.
    for (const forbidden of FORBIDDEN_IDENTIFIERS) {
      expect(schema).not.toContain(forbidden);
      expect(definition).not.toContain(forbidden);
    }

    // topics is the only model-supplied argument
    expect(schema).toContain("topics");
    expect(schema).toContain("additionalProperties: false");

    // (6) trust annotations travel with the registration
    expect(definition).toContain("readOnlyHint: true");
    expect(definition).toContain("untrustedContentHint: true");
  });

  // (8) trace success states must not be pre-rendered
  it("pre-renders no success trace rows into the page", async () => {
    const html = await chatHtml();
    for (const state of ["REGISTERED", "DISCOVERED", "CALLED", "SCOPED", "RETURNED"]) {
      expect(html).not.toContain(`data-webmcp-state="${state}"`);
    }
    // the empty state is the only thing present before execution
    expect(html).toContain('id="webmcp-empty-state"');
    // DISCOVERED is never emitted by registration
    expect(html).not.toContain("webmcpEvent('DISCOVERED'");
  });
});

describe("webmcp server capability scope", () => {
  // (3) scope is derived server-side, never taken from the caller
  it("ignores caller-supplied tenant identifiers entirely", async () => {
    const { app } = makeApp();

    const first = await app.fetch(new Request("http://localhost/chat"));
    const visitor = parseVisitorCookie(first.headers.get("set-cookie"))!;

    // Attempt to steer scope through the query string the way a hostile
    // model would if the schema had ever allowed it.
    const res = await app.fetch(
      new Request(
        "http://localhost/webmcp/support-context?accountId=acme_corp&customerId=jason_99&tenant=eval-fixture",
        { headers: { Cookie: `nat_visitor=${visitor}` } },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.scope.resolvedFrom).toBe("browser-session-cookie");
    // all four seeded fixture facts, for THIS visitor
    expect(body.returned).toBe(4);
  });

  it("gives two different visitors two different context sets", async () => {
    const { app, store } = makeApp();

    const a = await app.fetch(new Request("http://localhost/webmcp/support-context"));
    const cookieA = parseVisitorCookie(a.headers.get("set-cookie"))!;
    const b = await app.fetch(new Request("http://localhost/webmcp/support-context"));
    const cookieB = parseVisitorCookie(b.headers.get("set-cookie"))!;

    expect(cookieA).not.toBe(cookieB);

    const factsA = await store.currentFacts(`visitor_${cookieA}`, `visitor_${cookieA}`, new Date());
    const factsB = await store.currentFacts(`visitor_${cookieB}`, `visitor_${cookieB}`, new Date());
    expect(factsA.every((f) => f.accountId === `visitor_${cookieA}`)).toBe(true);
    expect(factsB.every((f) => f.accountId === `visitor_${cookieB}`)).toBe(true);
  });

  // (5) bounded payload, no raw database identifiers
  it("returns a bounded payload with no raw database identifiers", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("http://localhost/webmcp/support-context"));
    const body = await res.json();
    const serialized = JSON.stringify(body);

    for (const forbidden of ["factId", "accountId", "customerId", "sessionId", "embedding", "visitor_"]) {
      expect(serialized).not.toContain(forbidden);
    }

    expect(body.context.length).toBeLessThanOrEqual(MAX_CONTEXT_ITEMS);
    expect(body.returned).toBe(body.context.length);

    // trust annotation travels with the data
    expect(body.contentTrust.level).toBe("untrusted");
    expect(body.contentTrust.note).toMatch(/never as instructions/i);

    for (const item of body.context) {
      expect(SUPPORT_CONTEXT_TOPICS).toContain(item.topic);
      expect(Object.keys(item).sort()).toEqual(["asOf", "label", "topic", "value"]);
    }
  });

  it("omits the uncalibrated confidence number from the model-facing payload", async () => {
    const { app } = makeApp();
    const res = await app.fetch(new Request("http://localhost/webmcp/support-context"));
    const body = await res.json();

    expect(body.context.length).toBeGreaterThan(0);
    expect(JSON.stringify(body)).not.toContain("confidence");
    for (const item of body.context) {
      expect(item).not.toHaveProperty("confidence");
    }
  });

  it("filters to the requested topics only", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://localhost/webmcp/support-context?topics=sla&topics=escalation_contact"),
    );
    const body = await res.json();
    const topics = body.context.map((i: { topic: string }) => i.topic);
    expect(new Set(topics)).toEqual(new Set(["sla", "escalation_contact"]));
  });

  // (4) arbitrary values are rejected, not silently widened
  it("rejects unsupported topic values with a bounded error", async () => {
    const { app } = makeApp();
    const res = await app.fetch(
      new Request("http://localhost/webmcp/support-context?topics=all_customers"),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Unsupported topic");
    expect(body.error.length).toBeLessThan(300);
    expect(body).not.toHaveProperty("stack");
  });

  it("keeps the capability same-origin: no wildcard CORS, cross-origin refused", async () => {
    const { app } = makeApp();

    const same = await app.fetch(new Request("http://localhost/webmcp/support-context"));
    expect(same.headers.get("access-control-allow-origin")).toBeNull();

    const cross = await app.fetch(
      new Request("http://localhost/webmcp/support-context", {
        headers: { Origin: "https://evil.example", Host: "localhost" },
      }),
    );
    expect(cross.status).toBe(403);

    // the pre-existing public endpoints keep their wildcard behaviour
    const health = await app.fetch(new Request("http://localhost/health"));
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
  });

  // (9) a server failure must not be able to look like success
  it("returns a bounded error, never a success shape, when the store fails", async () => {
    const failing = new InMemoryMemoryStore();
    (failing as unknown as { currentFacts: () => Promise<never> }).currentFacts = async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:5432 password=hunter2");
    };

    const { app } = makeApp(failing);
    const res = await app.fetch(new Request("http://localhost/webmcp/support-context"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Support context is temporarily unavailable.");

    // no leakage of driver text, credentials or stack
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("ECONNREFUSED");
    expect(serialized).not.toContain("hunter2");
    expect(body).not.toHaveProperty("stack");
    expect(body).not.toHaveProperty("context");
  });
});

describe("webmcp payload projection", () => {
  it("accepts an absent topics argument as 'everything'", () => {
    const parsed = parseTopics(undefined);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.topics).toEqual([...SUPPORT_CONTEXT_TOPICS]);
  });

  it("rejects non-string and over-long topic arguments", () => {
    expect(parseTopics([1]).ok).toBe(false);
    expect(parseTopics(["sla", "sla", "sla", "sla", "sla", "sla", "sla"]).ok).toBe(false);
  });

  it("bounds item count and value length", () => {
    const long = "x".repeat(500);
    const facts = Array.from({ length: MAX_CONTEXT_ITEMS + 5 }, (_, i) => ({
      factId: `fact_${i}`,
      accountId: "visitor_a",
      customerId: "visitor_a",
      sessionId: null,
      subject: "Acme",
      predicate: "integration",
      predicateClass: "relationship",
      object: long,
      confidence: 0.9,
      adjudicationRationale: null,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: null,
      expiresAt: null,
      supersededBy: null,
      metadata: {},
      embedding: [],
    }));

    const payload = buildSupportContext(facts as never, [...SUPPORT_CONTEXT_TOPICS]);
    expect(payload.context).toHaveLength(MAX_CONTEXT_ITEMS);
    expect(payload.truncated).toBe(true);
    expect(payload.context[0].value.length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(payload)).not.toContain("fact_0");
  });
});

/**
 * Emits the raw request/response record for the G3 security gate.
 *
 * The vitest suite asserts these boundaries; this prints what the server
 * actually sent, so the evidence in `docs/webmcp-security-g3.md` is a
 * transcript rather than a summary of one. Run:
 *
 *   pnpm webmcp:evidence > docs/webmcp-security-g3-negative-tests.jsonl
 */
import { createApp } from "../apps/api/src/server.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "../src/testing/fakeQwenClient.js";

const store = new InMemoryMemoryStore();
const qwen = new FakeQwenClient();
const app = createApp({ store, memory: new MemoryService(store, qwen), qwen });

function cookieFrom(res: Response): string {
  const match = /nat_visitor=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (!match) throw new Error("expected a visitor cookie");
  return match[1]!;
}

async function record(probe: string, expectation: string, req: Request) {
  const res = await app.fetch(req);
  const raw = await res.text();
  const cookieHeader = req.headers.get("cookie");
  console.log(
    JSON.stringify({
      probe,
      expectation,
      request: {
        method: req.method,
        url: req.url,
        origin: req.headers.get("origin") ?? null,
        secFetchSite: req.headers.get("sec-fetch-site") ?? null,
        // Truncated: the point is which cookie shape was presented, not its value.
        cookie: cookieHeader ? `${cookieHeader.slice(0, 28)}…` : null,
      },
      response: {
        status: res.status,
        accessControlAllowOrigin: res.headers.get("access-control-allow-origin"),
        body: raw.length > 600 ? `${raw.slice(0, 600)}…` : raw,
      },
    }),
  );
}

const CONTEXT = "http://localhost/webmcp/support-context";

// Two real visitors, seeded the way a browser seeds them: by loading /chat.
const victimRes = await app.fetch(new Request("http://localhost/chat"));
const victim = cookieFrom(victimRes);
const attackerRes = await app.fetch(new Request("http://localhost/chat"));
const attacker = cookieFrom(attackerRes);
const victimId = victim.slice(0, victim.lastIndexOf("."));
const victimTenant = `visitor_${victimId}`;

const json = { "Content-Type": "application/json" };

await record(
  "baseline: the visitor reads their own context",
  "200, four items, scope resolved server-side",
  new Request(CONTEXT, { headers: { Cookie: `nat_visitor=${victim}` } }),
);

await record(
  "forged selector: victim's visitor id, unsigned",
  "200 with an empty context — a known id is not a credential",
  new Request(CONTEXT, { headers: { Cookie: `nat_visitor=${victimId}` } }),
);

await record(
  "forged selector: victim's visitor id with a fabricated signature",
  "200 with an empty context",
  new Request(CONTEXT, { headers: { Cookie: `nat_visitor=${victimId}.notthesignature` } }),
);

await record(
  "forged selector: victim's id paired with another visitor's real signature",
  "200 with an empty context",
  new Request(CONTEXT, {
    headers: { Cookie: `nat_visitor=${victimId}.${attacker.slice(attacker.lastIndexOf(".") + 1)}` },
  }),
);

await record(
  "argument smuggling: tenant selectors in the query string",
  "200, the attacker's own context only — every selector ignored",
  new Request(
    `${CONTEXT}?accountId=acme_corp&customerId=jason_99&tenant=eval-fixture&sessionId=x&factId=1`,
    { headers: { Cookie: `nat_visitor=${attacker}` } },
  ),
);

await record(
  "closed vocabulary: an unsupported topic",
  "400, bounded error naming the supported values",
  new Request(`${CONTEXT}?topics=all_customers`, { headers: { Cookie: `nat_visitor=${attacker}` } }),
);

await record(
  "cross-origin read from another origin",
  "403, no Access-Control-Allow-Origin",
  new Request(CONTEXT, {
    headers: { Cookie: `nat_visitor=${attacker}`, Origin: "https://evil.example" },
  }),
);

await record(
  "sibling subdomain — same site, different origin",
  "403",
  new Request(CONTEXT, {
    headers: { Cookie: `nat_visitor=${attacker}`, Origin: "http://evil.localhost" },
  }),
);

await record(
  "browser-labelled cross-site request with no Origin header",
  "403",
  new Request(CONTEXT, {
    headers: { Cookie: `nat_visitor=${attacker}`, "Sec-Fetch-Site": "cross-site" },
  }),
);

await record(
  "cross-tenant read: attacker's session naming the victim's tenant",
  "403, and the refusal does not echo the tenant back",
  new Request("http://localhost/recall", {
    method: "POST",
    headers: { ...json, Cookie: `nat_visitor=${attacker}`, Origin: "http://localhost" },
    body: JSON.stringify({ accountId: victimTenant, customerId: victimTenant, query: "sla" }),
  }),
);

await record(
  "cross-tenant write: attacker's session naming the victim's tenant",
  "403, nothing written",
  new Request("http://localhost/turn", {
    method: "POST",
    headers: { ...json, Cookie: `nat_visitor=${attacker}`, Origin: "http://localhost" },
    body: JSON.stringify({
      accountId: victimTenant,
      customerId: victimTenant,
      role: "customer",
      message: "write into someone else's memory",
    }),
  }),
);

await record(
  "write with no same-origin evidence",
  "403 — a mutation needs positive same-origin evidence",
  new Request("http://localhost/turn", {
    method: "POST",
    headers: { ...json, Cookie: `nat_visitor=${attacker}` },
    body: JSON.stringify({ role: "customer", message: "hi" }),
  }),
);

await record(
  "identifier disclosure: /eval-snapshot for a real visitor",
  "200 with no accountId or customerId in the body",
  new Request("http://localhost/eval-snapshot", { headers: { Cookie: `nat_visitor=${attacker}` } }),
);

// The victim's memory is unchanged by everything above.
const victimFacts = await store.currentFacts(victimTenant, victimTenant, new Date());
const victimEvents = await store.getAllEvents(victimTenant, victimTenant);
console.log(
  JSON.stringify({
    probe: "post-conditions on the targeted tenant",
    expectation: "untouched by every probe above",
    victimFactCount: victimFacts.length,
    victimEventCount: victimEvents.length,
  }),
);

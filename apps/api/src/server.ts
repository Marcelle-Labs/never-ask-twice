import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serve } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie } from "hono/cookie";
import { logger } from "hono/logger";
import { z } from "zod";

import type { QwenClient } from "../../../src/qwen/qwenClient.js";
import { createQwenClient } from "../../../src/qwen/qwenClient.js";
import { MEMORY_EMBEDDING_DIM } from "../../../src/contracts.js";
import { MemoryService, SessionNotFoundError } from "../../../src/memory/service.js";
import type { MemoryStore } from "../../../src/memory/types.js";
import { runSupportTurn } from "../../../src/agent/supportAgent.js";
import { getDb } from "./db.js";
import { DrizzleMemoryStore } from "./drizzleStore.js";
import { brandFaviconSvg } from "./ui/brand.js";
import { ChatView, FactsView } from "./ui/views.js";
import { SITE_URL, SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION, seoHeadTags } from "./ui/seo.js";
import {
  buildSupportContext,
  parseTopics,
  SUPPORT_CONTEXT_TOPICS,
} from "./webmcp/supportContext.js";
import {
  enforceSameOrigin,
  isBrowserOriginated,
  mintVisitorCookie,
  tenantForVisitor,
  verifyVisitorCookie,
} from "./webmcp/scope.js";

// ---------------------------------------------------------------------------
// Qwen client - zero-vector fallback when DASHSCOPE_API_KEY is absent
// ---------------------------------------------------------------------------
function buildQwenClient(): QwenClient {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.warn(
      "[qwenClient] No DASHSCOPE_API_KEY - returning zero vectors and empty distillations. LOCAL DEV ONLY."
    );
    return {
      async embed(_input: string) {
        console.warn(
          "[qwenClient] No DASHSCOPE_API_KEY - returning zero vector. Local dev only."
        );
        return new Array(MEMORY_EMBEDDING_DIM).fill(0) as number[];
      },
      async chat(input: { system: string; user: string }) {
        console.warn("[qwenClient] No DASHSCOPE_API_KEY - returning empty chat. Local dev only.");
        return "";
      },
      async distill(input: { transcript: string }) {
        console.warn(
          "[qwenClient] No DASHSCOPE_API_KEY - returning empty distillation. Local dev only."
        );
        return [];
      },
      async adjudicate(input: { currentFact: string; candidateFact: string }) {
        console.warn(
          "[qwenClient] No DASHSCOPE_API_KEY - returning empty adjudication. Local dev only."
        );
        return "";
      },
    };
  }
  return createQwenClient();
}

function capabilityStatus() {
  const qwenConfigured = Boolean(process.env.DASHSCOPE_API_KEY);
  const databaseConfigured = Boolean(process.env.DATABASE_URL);

  return {
    ok: true,
    qwenConfigured,
    databaseConfigured,
    mode: qwenConfigured ? "qwen-live" : "local-safe",
  };
}

// ---------------------------------------------------------------------------
// Per-visitor tenant scoping
// ---------------------------------------------------------------------------
const VISITOR_COOKIE = "nat_visitor";

const ACME_FIXTURE_FACTS = [
  { subject: "Acme Robotics", predicate: "sla_tier", predicateClass: "contract", object: "gold", confidence: 0.95 },
  { subject: "Acme Robotics", predicate: "product_config", predicateClass: "configuration", object: "requires SSO", confidence: 0.95 },
  { subject: "Acme Robotics", predicate: "integration", predicateClass: "relationship", object: "Salesforce", confidence: 0.95 },
  { subject: "Acme Robotics", predicate: "escalation_contact", predicateClass: "relationship", object: "Priya", confidence: 0.95 },
] as const;

export async function seedVisitorFacts(
  store: MemoryStore,
  qwen: QwenClient,
  accountId: string,
  customerId: string,
) {
  const existing = await store.currentFacts(accountId, customerId, new Date());
  // Per-predicate rather than "any fact exists". A seed interrupted partway
  // through used to leave the visitor permanently short of facts, because the
  // presence of the first fact suppressed every later attempt. `upsertSeedFact`
  // is idempotent per predicate, so re-running completes a partial seed.
  const seeded = new Set(existing.map((fact) => fact.predicate));
  const missing = ACME_FIXTURE_FACTS.filter((fact) => !seeded.has(fact.predicate));
  if (missing.length === 0) return;

  const now = new Date();
  for (const fact of missing) {
    const embedding = await qwen.embed(`${fact.subject} ${fact.predicate} ${fact.object}`);
    await store.upsertSeedFact({
      accountId,
      customerId,
      sessionId: null,
      subject: fact.subject,
      predicate: fact.predicate,
      predicateClass: fact.predicateClass,
      object: fact.object,
      confidence: fact.confidence,
      adjudicationRationale: null,
      validFrom: now,
      validTo: null,
      expiresAt: null,
      supersededBy: null,
      metadata: {},
      embedding,
    });
  }
}

/**
 * Reads the visitor's tenant from the signed cookie without minting one.
 * Returns null when the cookie is absent, malformed, or not signed by this
 * server — an unverifiable value is never a tenant.
 */
function resolveVisitor(c: Context): { accountId: string; customerId: string } | null {
  const visitorId = verifyVisitorCookie(getCookie(c, VISITOR_COOKIE));
  return visitorId ? tenantForVisitor(visitorId) : null;
}

function getOrCreateVisitor(c: Context): {
  accountId: string;
  customerId: string;
  isNew: boolean;
} {
  const existing = resolveVisitor(c);
  if (existing) return { ...existing, isNew: false };

  const { visitorId, cookieValue } = mintVisitorCookie();
  // Secure is set whenever the request arrived over HTTPS (behind the platform
  // proxy the scheme shows up in x-forwarded-proto, not in the request URL).
  const forwardedProto = c.req.header("x-forwarded-proto");
  const isHttps = forwardedProto
    ? forwardedProto.split(",")[0].trim() === "https"
    : new URL(c.req.url).protocol === "https:";
  setCookie(c, VISITOR_COOKIE, cookieValue, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return { ...tenantForVisitor(visitorId), isNew: true };
}

type TenantResolution =
  | { ok: true; accountId: string; customerId: string }
  | { ok: false; status: 400 | 403; error: string };

/**
 * Tenant resolution for the routes that accept `accountId`/`customerId` in a
 * request body.
 *
 * A browser-attributable request may not choose: its scope is the signed
 * cookie, and a body naming anything else is refused rather than quietly
 * rewritten, so a probing agent gets an explicit boundary instead of silent
 * coercion. A caller with direct network access is the trusted server-side API
 * and keeps today's behaviour; it is bounded instead by having no wildcard CORS
 * (so no page can reach it cross-origin) and by the page never being told a
 * tenant id it could replay.
 */
function resolveCallerTenant(
  c: Context,
  requested: { accountId?: string; customerId?: string },
): TenantResolution {
  if (!isBrowserOriginated(c)) {
    if (!requested.accountId || !requested.customerId) {
      return { ok: false, status: 400, error: "accountId and customerId are required." };
    }
    return { ok: true, accountId: requested.accountId, customerId: requested.customerId };
  }

  const visitor = resolveVisitor(c);
  if (!visitor) {
    return { ok: false, status: 403, error: "No valid visitor session for this request." };
  }
  // The page omits these entirely. A browser request that names a tenant is
  // refused rather than silently rewritten, so a probing agent is told the
  // boundary exists instead of being handed a success it did not earn.
  if (
    (requested.accountId !== undefined && requested.accountId !== visitor.accountId) ||
    (requested.customerId !== undefined && requested.customerId !== visitor.customerId)
  ) {
    return { ok: false, status: 403, error: "Request scope does not match this visitor session." };
  }
  return { ok: true, ...visitor };
}

// ---------------------------------------------------------------------------
// App factory — injectable for tests
// ---------------------------------------------------------------------------
export function createApp(deps: { store: MemoryStore; memory: MemoryService; qwen: QwenClient }) {
  const { store, memory, qwen } = deps;
  const app = new Hono();
  app.use("*", logger());

  // Wildcard CORS is fine for genuinely public endpoints (/health, the static
  // assets, the marketing pages) but must not extend to anything that reads or
  // writes a tenant's memory. G1 carved out /webmcp/* on that reasoning; the
  // same reasoning applies to every route that resolves a tenant, whether from
  // the visitor cookie or from a request body. Those routes are served with no
  // CORS headers at all, so a cross-origin page cannot read their responses.
  //
  // This is the layer that keeps the trusted server-side API — which does still
  // accept tenant identifiers by design, for the MCP server and the eval
  // harness — out of reach of anything running in a browser.
  const TENANT_SCOPED_PREFIXES = [
    "/webmcp/",
    "/turn",
    "/recall",
    "/sessions/",
    "/chat",
    "/facts",
    "/eval-snapshot",
  ];
  const isTenantScoped = (path: string) =>
    TENANT_SCOPED_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));

  const globalCors = cors();
  app.use("*", async (c, next) => {
    if (isTenantScoped(c.req.path)) return next();
    return globalCors(c, next);
  });

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
  app.get("/health", (c) => c.json(capabilityStatus(), 200));

app.get("/favicon.svg", (c) => c.text(brandFaviconSvg, 200, {
  "Cache-Control": "public, max-age=31536000, immutable",
  "Content-Type": "image/svg+xml; charset=utf-8",
}));

// ---------------------------------------------------------------------------
// GET /
// Landing page — static HTML with server-side SEO tag injection
// ---------------------------------------------------------------------------
app.get("/", async (c) => {
  const landingPath = fileURLToPath(new URL("./ui/landing.html", import.meta.url));
  try {
    let html = readFileSync(landingPath, "utf8");
    html = html.replace("<!--SEO-->", () =>
      seoHeadTags({
        title: `${SITE_NAME} — ${SITE_TAGLINE}`,
        description: SITE_DESCRIPTION,
        path: "/",
      })
    );
    return c.html(html);
  } catch (err) {
    console.error("[ui] Failed to read landing page:", err);
    return c.text("Landing page not found", 500);
  }
});

// ---------------------------------------------------------------------------
// GET /robots.txt, /sitemap.xml, /llms.txt
// ---------------------------------------------------------------------------
app.get("/robots.txt", (c) => {
  const body = `User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: *
Allow: /
Disallow: /turn
Disallow: /sessions/
Disallow: /eval-snapshot
Disallow: /facts
Disallow: /health

Sitemap: ${SITE_URL}/sitemap.xml
`;
  return c.text(body, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

app.get("/sitemap.xml", (c) => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>${SITE_URL}/</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>1.0</priority></url>
<url><loc>${SITE_URL}/chat</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>
</urlset>
`;
  return c.body(body, 200, { "Content-Type": "application/xml; charset=utf-8" });
});

app.get("/llms.txt", (c) => {
  const body = `# ${SITE_NAME}

> ${SITE_TAGLINE} ${SITE_DESCRIPTION}

## Product

- [Live demo](${SITE_URL}/chat): Send the same support request with memory on and memory off. Recall chips and the memory trace show exactly which facts the agent used, where they came from, and why.
- [Landing page](${SITE_URL}/): Overview of the memory architecture and the audit problem it solves.

## About

Built by Qwynn Marcelle for the Qwen Cloud Global AI Hackathon (Track: MemoryAgent). More on the underlying approach: https://marcellelabs.io/insights/building-customer-support-memory-survives-audit
`;
  return c.text(body, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

// ---------------------------------------------------------------------------
// POST /turn
// Body: { accountId, customerId, sessionId?, role, message, ts?, memoryMode? }
// Auto-creates session on first turn. Runs support agent for customer turns.
// ---------------------------------------------------------------------------
const TurnBodySchema = z.object({
  // Optional because the browser must not send them: the page omits them and
  // the server derives scope from the signed cookie. A server-side caller still
  // supplies both, and `resolveCallerTenant` rejects a request that has neither
  // a session nor identifiers.
  accountId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  sessionId: z.string().optional(),
  role: z.enum(["customer", "agent"]),
  message: z.string().min(1),
  ts: z.string().optional(),
  memoryMode: z.enum(["on", "off"]).optional().default("on"),
});

app.post("/turn", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = TurnBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation error", issues: parsed.error.issues }, 400);
  }

  // A browser-attributable caller may not name a tenant; scope comes from the
  // signed cookie. This is a mutation, so the origin must be positively
  // same-origin rather than merely not-declared-otherwise.
  const originVerdict = enforceSameOrigin(c, "mutation");
  if (!originVerdict.ok && isBrowserOriginated(c)) {
    return c.json({ error: originVerdict.error }, 403);
  }
  const scope = resolveCallerTenant(c, parsed.data);
  if (!scope.ok) {
    return c.json({ error: scope.error }, scope.status);
  }

  const { accountId, customerId } = scope;
  const { role, message } = parsed.data;
  const sessionId = parsed.data.sessionId ?? randomUUID();
  const ts = parsed.data.ts ? new Date(parsed.data.ts) : new Date();
  if (Number.isNaN(ts.getTime())) {
    return c.json({ error: "Invalid ts date" }, 400);
  }
  const memoryMode = parsed.data.memoryMode ?? "on";

  try {
    // Auto-create session if it doesn't exist, then enforce tenant ownership
    await memory.createSession({ accountId, customerId, sessionId });
    const event = await memory.appendTurn({ accountId, customerId, sessionId, role, message, ts });

    // Run support agent for customer messages
    let agentResponse: Awaited<ReturnType<typeof runSupportTurn>> | null = null;
    if (role === "customer") {
      agentResponse = await runSupportTurn({
        accountId,
        customerId,
        sessionId,
        query: message,
        memoryMode,
        memoryService: memory,
        now: ts,
      });

      // persist the agent's reply as an event too — previously only
      // the customer's message was appended, so agent bubbles vanished on
      // a page reload mid-session.
      if (agentResponse.answer) {
        await memory.appendTurn({
          accountId,
          customerId,
          sessionId,
          role: "agent",
          message: agentResponse.answer,
          ts: new Date(),
        });
      }
    }

    return c.json({
      ok: true,
      sessionId,
      eventId: event.eventId,
      answer: agentResponse?.answer ?? null,
      citedFacts: agentResponse?.citedFacts ?? [],
      askedForMissingFacts: agentResponse?.askedForMissingFacts ?? false,
    }, 201);
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    console.error("[turn] Failed to process turn:", err);
    return c.json({ error: "Failed to process turn" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /sessions/:id/close
// Body: { accountId, customerId, closedAt? }
// Triggers distillation of episodic events -> semantic facts.
// ---------------------------------------------------------------------------
const CloseBodySchema = z.object({
  accountId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  closedAt: z.string().optional(),
});

app.post("/sessions/:id/close", async (c) => {
  const sessionId = c.req.param("id");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = CloseBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation error", issues: parsed.error.issues }, 400);
  }

  const closeOrigin = enforceSameOrigin(c, "mutation");
  if (!closeOrigin.ok && isBrowserOriginated(c)) {
    return c.json({ error: closeOrigin.error }, 403);
  }
  const closeScope = resolveCallerTenant(c, parsed.data);
  if (!closeScope.ok) {
    return c.json({ error: closeScope.error }, closeScope.status);
  }

  const { accountId, customerId } = closeScope;
  const closedAt = parsed.data.closedAt ? new Date(parsed.data.closedAt) : new Date();
  if (Number.isNaN(closedAt.getTime())) {
    return c.json({ error: "Invalid closedAt date" }, 400);
  }

  try {
    const result = await memory.closeSession({ sessionId, accountId, customerId, closedAt });
    return c.json(
      {
        ok: true,
        sessionId,
        factsDistilled: result.facts.length,
        distillationStatus: "complete",
      },
      200
    );
  } catch (err) {
    if (err instanceof SessionNotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    console.error("[close] Failed to close session:", err);
    return c.json({ error: "Failed to close session" }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /recall
// Body: { accountId, customerId, sessionId?, query, tokenBudget? }
// ---------------------------------------------------------------------------
const RecallBodySchema = z.object({
  accountId: z.string().min(1).optional(),
  customerId: z.string().min(1).optional(),
  sessionId: z.string().optional(),
  query: z.string().min(1),
  tokenBudget: z.number().int().positive().optional(),
});

app.post("/recall", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = RecallBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Validation error", issues: parsed.error.issues }, 400);
  }

  // A read, so `Origin` need only be absent-or-matching; but a browser caller
  // still cannot select a tenant. Without this, a page script that learned any
  // tenant id could read that tenant's memory straight out of the browser,
  // which would make the WebMCP argument surface cosmetic.
  const recallOrigin = enforceSameOrigin(c, "read");
  if (!recallOrigin.ok) {
    return c.json({ error: recallOrigin.error }, 403);
  }
  const recallScope = resolveCallerTenant(c, parsed.data);
  if (!recallScope.ok) {
    return c.json({ error: recallScope.error }, recallScope.status);
  }

  const { accountId, customerId } = recallScope;
  const { sessionId, query } = parsed.data;
  const envBudget = Number(process.env.MEMORY_TOKEN_BUDGET ?? 1200);
  const tokenBudget = parsed.data.tokenBudget ?? (Number.isNaN(envBudget) || envBudget <= 0 ? 1200 : envBudget);
  const now = new Date();

  try {
    const result = await memory.recall({ accountId, customerId, sessionId, query, tokenBudget, now });
    return c.json(
      {
        ok: true,
        bundle: result.bundle.map((item) => ({
          kind: item.kind,
          score: item.score,
          summary: item.summary,
        })),
        usedTokens: result.usedTokens,
        dropList: result.dropList,
      },
      200
    );
  } catch (err) {
    console.error("[recall] Failed to recall:", err);
    return c.json({ error: "Failed to recall" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /recall?sessionId=...
// Returns recall bundle for the visitor's session. If sessionId doesn't exist
// or doesn't belong to the caller's tenant, returns an empty bundle — never
// returns facts for a non-existent session.
// ---------------------------------------------------------------------------
app.get("/recall", async (c) => {
  const sessionId = c.req.query("sessionId");
  if (!sessionId || sessionId.trim().length === 0) {
    return c.json({ ok: true, bundle: [], usedTokens: 0, dropList: [] }, 200);
  }

  const { accountId, customerId } = getOrCreateVisitor(c);
  const session = await store.getSession(sessionId);
  if (!session || session.accountId !== accountId || session.customerId !== customerId) {
    return c.json({ ok: true, bundle: [], usedTokens: 0, dropList: [] }, 200);
  }

  const query = c.req.query("query") ?? "general";
  const envBudget = Number(process.env.MEMORY_TOKEN_BUDGET ?? 1200);
  const tokenBudget = Number.isNaN(envBudget) || envBudget <= 0 ? 1200 : envBudget;
  const now = new Date();

  try {
    const result = await memory.recall({ accountId, customerId, sessionId, query, tokenBudget, now });
    return c.json(
      {
        ok: true,
        bundle: result.bundle.map((item) => ({
          kind: item.kind,
          score: item.score,
          summary: item.summary,
        })),
        usedTokens: result.usedTokens,
        dropList: result.dropList,
      },
      200,
    );
  } catch (err) {
    console.error("[recall] Failed to recall:", err);
    return c.json({ error: "Failed to recall" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /webmcp/support-context   (WebMCP spike)
//
// Server capability behind the browser-native `get_support_context` tool.
// The model may name topics; it may NOT name a tenant. Scope comes from the
// same `getOrCreateVisitor` cookie path that /chat and /facts already trust,
// so there is exactly one tenant-selection code path in the app.
//
// Deliberately not a proxy for POST /recall: that interface takes accountId
// and customerId from the caller, which is precisely the authority a browser
// agent must never hold.
// ---------------------------------------------------------------------------
app.get("/webmcp/support-context", async (c) => {
  // Same-origin only. The route is excluded from the global wildcard CORS
  // above, so a cross-origin read is already blocked by the browser; this
  // rejects it at the server too rather than relying on one layer. Shared with
  // the other tenant-scoped routes so there is one origin rule, not several.
  const originVerdict = enforceSameOrigin(c, "read");
  if (!originVerdict.ok) {
    return c.json({ ok: false, error: originVerdict.error }, 403);
  }

  // Bounded input. Repeated ?topics= params and one comma-joined param are
  // both accepted because agent runtimes serialise array args either way.
  const rawTopics = c.req.queries("topics") ?? [];
  const flattened = rawTopics.flatMap((entry) => entry.split(",")).map((t) => t.trim()).filter(Boolean);
  const parsed = parseTopics(flattened.length > 0 ? flattened : undefined);
  if (!parsed.ok) {
    return c.json({ ok: false, error: parsed.error }, 400);
  }

  try {
    // Read-only, and mechanically so. This capability is annotated
    // `readOnlyHint: true`, and it used to call `seedVisitorFacts` — a
    // four-fact write loop. An abort partway through that loop left the
    // visitor permanently short of facts, so a "read" tool owned a
    // partial-mutation window. The route now performs no write at all; the
    // visitor is seeded when they load /chat, which is also the only place the
    // tool can be registered, so the capability still has facts to return.
    //
    // No cookie is minted here either: a caller with no session reads an empty
    // context rather than being issued a tenant by a read.
    const visitor = resolveVisitor(c);
    const facts = visitor
      ? await store.currentFacts(visitor.accountId, visitor.customerId, new Date())
      : [];
    const payload = buildSupportContext(facts, parsed.topics);
    return c.json(payload, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    // Bounded, actionable, and opaque: no stack, no driver text, no secrets.
    console.error("[webmcp] support-context failed:", err);
    return c.json({ ok: false, error: "Support context is temporarily unavailable." }, 500);
  }
});

// ---------------------------------------------------------------------------
// HTML UI Routes
// ---------------------------------------------------------------------------

// Static CSS
app.get("/static/index.css", (c) => {
  const cssPath = fileURLToPath(new URL("./ui/index.css", import.meta.url));
  try {
    const css = readFileSync(cssPath, "utf8");
    return c.text(css, 200, { "Content-Type": "text/css", "Cache-Control": "no-store" });
  } catch (err) {
    console.error("[ui] Failed to read CSS:", err);
    return c.text("body { background: #000; color: #fff; }", 200, { "Content-Type": "text/css", "Cache-Control": "no-store" });
  }
});

// Bundled Geist fonts — served locally so the demo works offline and in FC
const ALLOWED_FONTS: Record<string, string> = {
  "Geist-Variable.woff2": "./ui/fonts/Geist-Variable.woff2",
  "GeistMono-Variable.woff2": "./ui/fonts/GeistMono-Variable.woff2",
};

app.get("/static/fonts/:file", (c) => {
  const file = c.req.param("file");
  const rel = ALLOWED_FONTS[file];
  if (!rel) return c.notFound();
  const fontPath = fileURLToPath(new URL(rel, import.meta.url));
  try {
    const font = readFileSync(fontPath);
    return c.body(font, 200, {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch {
    return c.notFound();
  }
});

// Brand assets from docs/assets/brand
const BRAND_DIR = fileURLToPath(new URL("../../../docs/assets/brand", import.meta.url));
const BRAND_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

app.get("/static/brand/:file", (c) => {
  const file = c.req.param("file");
  const assetPath = path.resolve(BRAND_DIR, file);
  const relative = path.relative(BRAND_DIR, assetPath);
  if (relative === "" || relative.startsWith(".." + path.sep) || relative.startsWith("..")) return c.notFound();
  const ext = path.extname(file).toLowerCase();
  const mime = BRAND_MIME[ext];
  if (!mime) return c.notFound();
  try {
    const asset = readFileSync(assetPath);
    return c.body(asset, 200, {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch {
    return c.notFound();
  }
});

  app.get("/chat", async (c) => {
  const querySessionId = c.req.query("sessionId");
  const sessionId = querySessionId && querySessionId.trim().length > 0 ? querySessionId.trim() : randomUUID();
  const memoryOn = c.req.query("memory") !== "off";
  // WebMCP OFF control. `?webmcp=off` means the registration script is never
  // emitted, so the tool is genuinely absent from the page — not registered
  // and hidden. the WebMCP spike owns the counterfactual that uses this.
  const webmcpEnabled = c.req.query("webmcp") !== "off";
  const { qwenConfigured } = capabilityStatus();

  try {
    const { accountId, customerId } = getOrCreateVisitor(c);
    await memory.createSession({ accountId, customerId, sessionId });
    await seedVisitorFacts(store, qwen, accountId, customerId);
    const events = await store.getEvents(sessionId);
    const messages = events.map((e) => ({ role: e.role, message: e.message }));
    const facts = await store.currentFacts(accountId, customerId, new Date());
    const slaFact = facts.find((f) => f.predicate === "sla_tier");
    const slaTier = slaFact ? slaFact.object : null;
    return c.html(ChatView(messages, sessionId, memoryOn, slaTier, qwenConfigured, webmcpEnabled), 200, {
      "Cache-Control": "no-store",
    });
  } catch (err) {
    console.error("[chat] Failed to render chat:", err);
    return c.json({ error: "Failed to render chat" }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /eval-snapshot
// Returns live re-ask rates derived from current semantic fact store.
// Deterministic and read-only for ?tenant=eval-fixture. For a cookieless
// caller it mints a per-visitor tenant and seeds facts (Qwen embeds + DB
// writes) via resolveDashboardTenant -> seedVisitorFacts.
// ---------------------------------------------------------------------------
const REQUIRED_PREDICATES = ["sla_tier", "product_config", "integration", "escalation_contact"];
const EVAL_FIXTURE_TENANT = {
  accountId: "acme_corp",
  customerId: "jason_99",
} as const;

async function resolveDashboardTenant(c: Context, store: MemoryStore, qwen: QwenClient) {
  if (c.req.query("tenant") === "eval-fixture") {
    return { ...EVAL_FIXTURE_TENANT, isFixture: true as const };
  }

  const visitor = getOrCreateVisitor(c);
  await seedVisitorFacts(store, qwen, visitor.accountId, visitor.customerId);
  return { accountId: visitor.accountId, customerId: visitor.customerId, isFixture: false as const };
}

// This endpoint reports required-predicate COVERAGE over the current fact
// store. It is not an ablation. The previous shape returned
// `memoryOnReaskRate` (a coverage check dressed as a measured rate) and
// `memoryOffReaskRate: 1.0` (a hardcoded constant that was never measured at
// all), which the /facts view then captioned "live ablation". Both claims
// were false, so both fields are gone. Report what is actually derived from
// live data and nothing else.
app.get("/eval-snapshot", async (c) => {
  const { accountId, customerId, isFixture } = await resolveDashboardTenant(c, store, qwen);
  const facts = await store.currentFacts(accountId, customerId, new Date());
  const summaries = facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`);
  const missing = REQUIRED_PREDICATES.filter((p) => !summaries.some((s) => s.includes(p)));
  return c.json({
    ok: true,
    requiredPredicates: REQUIRED_PREDICATES.length,
    coveredPredicates: REQUIRED_PREDICATES.length - missing.length,
    factsCount: facts.length,
    missingPredicates: missing,
    // A real visitor's tenant id is never returned. The cookie is HttpOnly so
    // page script cannot read the tenant selector; handing the same identifier
    // back in a JSON body would undo that, and give anything running on the
    // page a value to replay against the tenant-parameterized API.
    //
    // The pinned eval fixture is a different case: `acme_corp` / `jason_99` are
    // public fixture constants, not a visitor, and the recording harness reads
    // them to confirm it is pointed at the fixture.
    ...(isFixture ? { accountId, customerId } : {}),
  }, 200);
});

  app.get("/facts", async (c) => {
  const { accountId, customerId } = await resolveDashboardTenant(c, store, qwen);
  const facts = await store.currentFacts(accountId, customerId, new Date());
  const summaries = facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`);
  const missing = REQUIRED_PREDICATES.filter((p) => !summaries.some((s) => s.includes(p)));
  return c.html(
    FactsView(facts, REQUIRED_PREDICATES.length - missing.length, REQUIRED_PREDICATES.length),
    200,
    { "Cache-Control": "no-store" },
  );
});

  return app;
}

// ---------------------------------------------------------------------------
// Function Compute handler
//
// FC3's Node.js runtime invokes this as handler(event, context) where `event`
// is a raw Buffer (NOT a parsed object) containing an API-Gateway-v1-style
// JSON payload: { rawPath, headers, queryParameters, body, isBase64Encoded,
// requestContext: { http: { method, path, ... } } }. Confirmed empirically
// against a live deployment (2026-07-16) — Alibaba's public docs did not
// resolve, and the previous version of this handler assumed a
// pre-parsed object with `path`/`httpMethod`/`queryString` fields that do
// not exist in the real payload, so every request silently fell through to
// the "/" default path.
// ---------------------------------------------------------------------------
interface FcHttpEvent {
  version?: string;
  rawPath?: string;
  headers?: Record<string, string | string[] | undefined>;
  queryParameters?: Record<string, string | string[] | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
}

function parseFcEvent(event: unknown): FcHttpEvent {
  try {
    if (Buffer.isBuffer(event)) {
      return JSON.parse(event.toString("utf8")) as FcHttpEvent;
    }
    if (typeof event === "string") {
      return JSON.parse(event) as FcHttpEvent;
    }
  } catch (err) {
    console.error("[fc-handler] Failed to parse event payload:", err);
    return {};
  }
  return (event ?? {}) as FcHttpEvent;
}

export async function handler(rawEvent: unknown, context: unknown) {
  const event = parseFcEvent(rawEvent);
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "/";
  const method = event.requestContext?.http?.method ?? "GET";
  const query = event.queryParameters ?? {};
  const queryPairs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) queryPairs.append(key, item);
    } else {
      queryPairs.append(key, value);
    }
  }
  const queryString = queryPairs.toString();
  const url = `http://localhost${path}${queryString ? `?${queryString}` : ""}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.append(key, value);
    }
  }

  const hasBody = !["GET", "HEAD"].includes(method.toUpperCase()) && Boolean(event.body);
  const body = hasBody
    ? event.isBase64Encoded
      ? Buffer.from(event.body as string, "base64")
      : (event.body as string)
    : null;

  const request = new Request(url, {
    method,
    headers,
    body,
  });

  const response = await bootstrapApp.fetch(request, context);

  // response.headers.forEach + plain object assignment would silently drop
  // all but the last Set-Cookie header if a response ever sets more than
  // one — getSetCookie() is the only correct way to read multiple values.
  const responseHeaders: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    responseHeaders[key] = value;
  });
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length === 1) {
    responseHeaders["set-cookie"] = setCookies[0];
  } else if (setCookies.length > 1) {
    responseHeaders["set-cookie"] = setCookies;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const isTextLike =
    contentType.startsWith("text/") ||
    contentType.startsWith("application/json") ||
    contentType.startsWith("application/javascript") ||
    contentType.startsWith("application/xml") ||
    contentType.startsWith("image/svg+xml");

  let responseBody: string;
  let isBase64Encoded = false;
  if (isTextLike) {
    responseBody = await response.text();
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    responseBody = buffer.toString("base64");
    isBase64Encoded = true;
  }

  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: responseBody,
    isBase64Encoded,
  };
}

// ---------------------------------------------------------------------------
// Local dev server
// ---------------------------------------------------------------------------
function isMainModule() {
  if (!process.argv[1]) return false;
  const entry = process.argv[1];
  return entry.endsWith("/server.ts") || entry.endsWith("\\server.ts") || entry.endsWith("/server.js") || entry.endsWith("\\server.js");
}

// ---------------------------------------------------------------------------
// Module-level bootstrap (guarded — tests only need createApp)
// ---------------------------------------------------------------------------
const bootstrapApp = process.env.DATABASE_URL
  ? (() => {
      const db = getDb();
      const store = new DrizzleMemoryStore(db);
      const qwen = buildQwenClient();
      const memory = new MemoryService(store, qwen);
      return createApp({ store, memory, qwen });
    })()
  : new Hono();

if (isMainModule()) {
  const port = Number(process.env.PORT ?? 3000);
  console.log(`[never-ask-twice] API listening on http://localhost:${port}`);
  serve({ fetch: bootstrapApp.fetch, port });
}

export default bootstrapApp;

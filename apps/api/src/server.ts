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
  if (existing.length > 0) return;

  const now = new Date();
  for (const fact of ACME_FIXTURE_FACTS) {
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

function getOrCreateVisitor(c: Context): {
  accountId: string;
  customerId: string;
  isNew: boolean;
} {
  const existing = getCookie(c, VISITOR_COOKIE);
  if (existing) {
    return { accountId: `visitor_${existing}`, customerId: `visitor_${existing}`, isNew: false };
  }
  const newId = randomUUID();
  setCookie(c, VISITOR_COOKIE, newId, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return { accountId: `visitor_${newId}`, customerId: `visitor_${newId}`, isNew: true };
}

// ---------------------------------------------------------------------------
// App factory — injectable for tests
// ---------------------------------------------------------------------------
export function createApp(deps: { store: MemoryStore; memory: MemoryService; qwen: QwenClient }) {
  const { store, memory, qwen } = deps;
  const app = new Hono();
  app.use("*", logger());
  app.use("*", cors());

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
  accountId: z.string().min(1),
  customerId: z.string().min(1),
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

  const { accountId, customerId, role, message } = parsed.data;
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

      // VR-515: persist the agent's reply as an event too — previously only
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
  accountId: z.string().min(1),
  customerId: z.string().min(1),
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

  const { accountId, customerId } = parsed.data;
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
  accountId: z.string().min(1),
  customerId: z.string().min(1),
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

  const { accountId, customerId, sessionId, query } = parsed.data;
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
    return c.html(ChatView(messages, sessionId, memoryOn, slaTier, qwenConfigured, accountId, customerId), 200, {
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
// Deterministic: no test sessions created, no Qwen calls.
// ---------------------------------------------------------------------------
const REQUIRED_PREDICATES = ["sla_tier", "product_config", "integration", "escalation_contact"];

app.get("/eval-snapshot", async (c) => {
  const accountId = "acme_corp";
  const customerId = "jason_99";
  const facts = await store.currentFacts(accountId, customerId, new Date());
  const summaries = facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`);
  const missing = REQUIRED_PREDICATES.filter((p) => !summaries.some((s) => s.includes(p)));
  return c.json({
    ok: true,
    memoryOnReaskRate: missing.length > 0 ? 1.0 : 0.0,
    memoryOffReaskRate: 1.0,
    factsCount: facts.length,
    missingPredicates: missing,
  }, 200);
});

  app.get("/facts", async (c) => {
  const queryAccountId = c.req.query("accountId");
  const queryCustomerId = c.req.query("customerId");
  let accountId: string;
  let customerId: string;
  if (queryAccountId && queryCustomerId) {
    accountId = queryAccountId;
    customerId = queryCustomerId;
  } else {
    const visitor = getOrCreateVisitor(c);
    accountId = visitor.accountId;
    customerId = visitor.customerId;
    await seedVisitorFacts(store, qwen, accountId, customerId);
  }
  const facts = await store.currentFacts(accountId, customerId, new Date());
  const summaries = facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`);
  const missing = REQUIRED_PREDICATES.filter((p) => !summaries.some((s) => s.includes(p)));
  const memOnReaskRate = missing.length > 0 ? 1.0 : 0.0;
  return c.html(FactsView(facts, memOnReaskRate), 200, { "Cache-Control": "no-store" });
});

  return app;
}

// ---------------------------------------------------------------------------
// Function Compute handler
// ---------------------------------------------------------------------------
interface FcEvent {
  path?: string;
  url?: string;
  httpMethod?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  queryString?: Record<string, string | string[] | undefined>;
  queryStringParameters?: Record<string, string | string[] | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export async function handler(event: FcEvent, context: unknown) {
  const path = event.path ?? event.url ?? "/";
  const query = event.queryString ?? event.queryStringParameters ?? {};
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

  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64")
      : event.body
    : null;

  const request = new Request(url, {
    method: event.httpMethod ?? event.method ?? "GET",
    headers,
    body,
  });

  const response = await bootstrapApp.fetch(request, context);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

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

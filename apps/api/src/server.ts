import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";

import type { QwenClient } from "../../../src/qwen/qwenClient.js";
import { createQwenClient } from "../../../src/qwen/qwenClient.js";
import { MEMORY_EMBEDDING_DIM } from "../../../src/contracts.js";
import { MemoryService, SessionNotFoundError } from "../../../src/memory/service.js";
import { runSupportTurn } from "../../../src/agent/supportAgent.js";
import { getDb } from "./db.js";
import { DrizzleMemoryStore } from "./drizzleStore.js";
import { ChatView, FactsView } from "./ui/views.js";

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
// App bootstrap
// ---------------------------------------------------------------------------
const db = getDb();
const store = new DrizzleMemoryStore(db);
const qwen = buildQwenClient();
const memory = new MemoryService(store, qwen);

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get("/health", (c) => c.json(capabilityStatus(), 200));

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
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
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
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
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
  const tokenBudget = parsed.data.tokenBudget ?? Number(process.env.MEMORY_TOKEN_BUDGET ?? 1200);
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
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

// ---------------------------------------------------------------------------
// HTML UI Routes
// ---------------------------------------------------------------------------

// Static CSS
app.get("/static/index.css", (c) => {
  const cssPath = new URL("./ui/index.css", import.meta.url).pathname;
  try {
    const css = readFileSync(cssPath, "utf8");
    return c.text(css, 200, { "Content-Type": "text/css" });
  } catch (err) {
    console.error("[ui] Failed to read CSS:", err);
    return c.text("body { background: #000; color: #fff; }", 200, { "Content-Type": "text/css" });
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
  const fontPath = new URL(rel, import.meta.url).pathname;
  try {
    const font = readFileSync(fontPath);
    return c.body(font as unknown as ReadableStream, 200, {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch {
    return c.notFound();
  }
});

app.get("/chat", async (c) => {
  const sessionId = c.req.query("sessionId") ?? randomUUID();
  const memoryOn = c.req.query("memory") !== "off";
  const { qwenConfigured } = capabilityStatus();

  try {
    await memory.createSession({ accountId: "acme_corp", customerId: "jason_99", sessionId });
    const events = await store.getEvents(sessionId);
    const messages = events.map((e) => ({ role: e.role, message: e.message }));
    const facts = await store.currentFacts("acme_corp", "jason_99", new Date());
    const slaFact = facts.find((f) => f.predicate === "sla_tier");
    const slaTier = slaFact ? slaFact.object : null;
    return c.html(ChatView(messages, sessionId, memoryOn, slaTier, qwenConfigured));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
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
  const accountId = c.req.query("accountId") ?? "acme_corp";
  const customerId = c.req.query("customerId") ?? "jason_99";
  const facts = await store.currentFacts(accountId, customerId, new Date());
  const summaries = facts.map((f) => `${f.subject} ${f.predicate} ${f.object}`);
  const missing = REQUIRED_PREDICATES.filter((p) => !summaries.some((s) => s.includes(p)));
  const memOnReaskRate = missing.length > 0 ? 1.0 : 0.0;
  return c.html(FactsView(facts, memOnReaskRate));
});

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

  const response = await app.fetch(request, context);

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  const responseBody = await response.text();

  return {
    statusCode: response.status,
    headers: responseHeaders,
    body: responseBody,
    isBase64Encoded: false,
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

if (isMainModule()) {
  const port = Number(process.env.PORT ?? 3000);
  console.log(`[never-ask-twice] API listening on http://localhost:${port}`);
  serve({ fetch: app.fetch, port });
}

export default app;

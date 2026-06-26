import { randomUUID } from "node:crypto";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { z } from "zod";

import type { QwenClient } from "../../../src/qwen/qwenClient.js";
import { createQwenClient } from "../../../src/qwen/qwenClient.js";
import { MEMORY_EMBEDDING_DIM } from "../../../src/contracts.js";
import { MemoryService, SessionNotFoundError } from "../../../src/memory/service.js";
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
const memory = new MemoryService(store as never, qwen);

const app = new Hono();
app.use("*", logger());
app.use("*", cors());

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get("/health", (c) => c.json(capabilityStatus(), 200));

// ---------------------------------------------------------------------------
// POST /turn
// Body: { accountId, customerId, sessionId?, role, message, ts? }
// Auto-creates session on first turn.
// ---------------------------------------------------------------------------
const TurnBodySchema = z.object({
  accountId: z.string().min(1),
  customerId: z.string().min(1),
  sessionId: z.string().optional(),
  role: z.enum(["customer", "agent"]),
  message: z.string().min(1),
  ts: z.string().optional(),
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

  try {
    // Auto-create session if it doesn't exist, then enforce tenant ownership
    await memory.createSession({ accountId, customerId, sessionId });
    const event = await memory.appendTurn({ accountId, customerId, sessionId, role, message, ts });
    return c.json({ ok: true, sessionId, eventId: event.eventId }, 201);
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
        bundle: result.bundle.map((item: any) => ({
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
app.get("/static/index.css", async (c) => {
  const cssPath = new URL("./ui/index.css", import.meta.url).pathname;
  try {
    const fs = await import("node:fs");
    const css = fs.readFileSync(cssPath, "utf8");
    return c.text(css, 200, { "Content-Type": "text/css" });
  } catch (err) {
    console.error("[ui] Failed to read CSS:", err);
    return c.text("body { background: #000; color: #fff; }", 200, { "Content-Type": "text/css" });
  }
});

app.get("/chat", async (c) => {
  const sessionId = c.req.query("sessionId") ?? randomUUID();
  const memoryOn = c.req.query("memory") !== "off";
  
  // For the demo, we start with an empty thread or fetch session events
  const events = await store.getEvents(sessionId);
  const messages = events.map((e: any) => ({ role: e.role, message: e.message }));
  
  return c.html(ChatView(messages, sessionId, memoryOn));
});

app.get("/facts", async (c) => {
  const accountId = c.req.query("accountId") ?? "acme_corp";
  const customerId = c.req.query("customerId") ?? "jason_99";
  const facts = await store.currentFacts(accountId, customerId, new Date());
  return c.html(FactsView(facts));
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

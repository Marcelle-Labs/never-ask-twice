import { test, expect, type Page, type BrowserContext } from "@playwright/test";

/**
 * Live regression harness for the G3 security candidate.
 *
 * G1 verified native discovery and execution by hand in Chrome with
 * `chrome://flags/#enable-webmcp-testing`, and separately ran a headless pass
 * under a stand-in WebMCP runtime. Only the *output* of that pass was
 * committed, so this file re-creates the harness and points it at the deployed
 * candidate, to check that the signed-cookie, CORS and tenant-binding changes
 * did not disturb registration, execution, scope reporting or the OFF control.
 *
 * The stand-in is not Chrome's native implementation. It exercises the page's
 * own registration and execute callback — the code path a real runtime drives —
 * but "Chrome's WebMCP Tools UI lists the tool" remains a manual check.
 */

const BASE_URL = process.env.DEMO_BASE_URL ?? "https://neverasktwice.dev";

/** The shape the capability returns, as far as this harness inspects it. */
interface SupportContextPayload {
  returned: number;
  truncated: boolean;
  topics: string[];
  scope: { resolvedFrom: string; knownVisitor: boolean };
  context: Array<{ topic: string; label: string; value: string; asOf: string }>;
  contentTrust: { level: string; kind: string; note: string };
}

/** Minimal WebMCP host, installed before any page script runs. */
const STAND_IN = `
  (() => {
    const tools = new Map();
    const host = {
      registerTool(def) { tools.set(def.name, def); return Promise.resolve({ ok: true }); },
      provideContext(ctx) {
        for (const t of (ctx && ctx.tools) || []) tools.set(t.name, t);
        return Promise.resolve({ ok: true });
      },
      getTools() { return [...tools.values()]; },
      executeTool(name, args) {
        const tool = tools.get(name);
        if (!tool) throw new Error('no such tool: ' + name);
        return tool.execute(args, { signal: undefined });
      },
    };
    Object.defineProperty(document, 'modelContext', { value: host, configurable: true });
    window.__standInHost = host;
  })();
`;

async function withStandIn(context: BrowserContext) {
  await context.addInitScript(STAND_IN);
}

const traceStates = (page: Page) =>
  page.$$eval("#webmcp-trace [data-webmcp-state]", (els) =>
    els.map((e) => e.getAttribute("data-webmcp-state")),
  );

test.describe("G3 live regression — deployed candidate", () => {
  test.setTimeout(120_000);

  test("A: reload preserves the same visitor and the same support context", async ({ page, context }) => {
    await withStandIn(context);
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });

    const read = async () =>
      page.evaluate(async () => {
        const res = await fetch("/webmcp/support-context", { credentials: "same-origin" });
        return res.json();
      });

    const before = await read();
    expect(before.scope.knownVisitor).toBe(true);
    expect(before.returned).toBe(4);

    // Reload twice. A signed cookie that failed to verify would mint a new
    // visitor here and the context would come back empty.
    await page.reload({ waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    const after = await read();

    expect(after.returned).toBe(before.returned);
    expect(after.context.map((i: { value: string }) => i.value).sort()).toEqual(
      before.context.map((i: { value: string }) => i.value).sort(),
    );
    // Same underlying facts, not a freshly seeded lookalike set.
    expect(after.context.map((i: { asOf: string }) => i.asOf).sort()).toEqual(
      before.context.map((i: { asOf: string }) => i.asOf).sort(),
    );
    console.log("[live][A] context after 2 reloads:", JSON.stringify(after.context.map((i: {value:string}) => i.value)));
  });

  test("C: registration, native-shaped execution, and the real trace chain", async ({ page, context }) => {
    await withStandIn(context);
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as never as { __natWebmcp: { registered: boolean } }).__natWebmcp?.registered === true, null, { timeout: 20_000 });

    // C3 — REGISTERED is emitted from real registration state.
    expect(await traceStates(page)).toContain("REGISTERED");

    // C2 (stand-in equivalent) — the tool is discoverable via getTools().
    const listed = await page.evaluate(() =>
      (window as never as { __standInHost: { getTools(): { name: string }[] } }).__standInHost
        .getTools()
        .map((t) => t.name),
    );
    expect(listed).toEqual(["get_support_context"]);

    // C8 — the model-facing schema exposes no tenant selector of any kind.
    const schema = await page.evaluate(() =>
      JSON.stringify(
        (window as never as { __natWebmcp: { definition: { inputSchema: unknown } } }).__natWebmcp
          .definition.inputSchema,
      ),
    );
    for (const forbidden of ["accountId", "customerId", "sessionId", "tenant", "factId", "visitor"]) {
      expect(schema, `schema must not expose ${forbidden}`).not.toContain(forbidden);
    }
    console.log("[live][C] model-facing inputSchema:", schema);

    // C4 — execute the tool the way a runtime does.
    const result = await page.evaluate(async () =>
      (window as never as { __standInHost: { executeTool(n: string, a: unknown): Promise<unknown> } })
        .__standInHost.executeTool("get_support_context", { topics: ["sla", "integration", "escalation_contact"] }),
    );
    const payload = (result as { structuredContent: SupportContextPayload }).structuredContent;

    // C5 — the real chain, in order, with no fabricated DISCOVERED row.
    const states = await traceStates(page);
    console.log("[live][C] trace states (newest first):", JSON.stringify(states));
    expect(states).toContain("CALLED");
    expect(states).toContain("SCOPED");
    expect(states).toContain("RETURNED");
    expect(states).not.toContain("DISCOVERED");
    expect(states).not.toContain("REJECTED");
    // rows are prepended, so newest first: RETURNED before SCOPED before CALLED
    expect(states.indexOf("RETURNED")).toBeLessThan(states.indexOf("SCOPED"));
    expect(states.indexOf("SCOPED")).toBeLessThan(states.indexOf("CALLED"));

    // C6 — scope is reported by the server, resolved from the cookie.
    expect(payload.scope.resolvedFrom).toBe("browser-session-cookie");
    expect(payload.scope.knownVisitor).toBe(true);

    // C7 — bounded, topic-filtered, marked untrusted.
    expect(payload.returned).toBe(3);
    expect(payload.contentTrust.level).toBe("untrusted");

    // C8 — no identifiers in the returned scope metadata either.
    const serialized = JSON.stringify(payload);
    for (const forbidden of ["accountId", "customerId", "sessionId", "factId", "visitor_", "embedding"]) {
      expect(serialized, `payload must not contain ${forbidden}`).not.toContain(forbidden);
    }
    console.log("[live][C] returned values:", JSON.stringify(payload.context.map((i: {value:string}) => i.value)));
  });

  test("D: ?webmcp=off registers nothing, stays usable, and preserves state", async ({ page, context }) => {
    await withStandIn(context);

    // Establish the visitor and capture their context on the ON page.
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    const read = async () =>
      page.evaluate(async () => {
        const res = await fetch("/webmcp/support-context", { credentials: "same-origin" });
        return res.json();
      });
    const onBefore = await read();
    expect(onBefore.returned).toBe(4);

    // OFF.
    await page.goto(`${BASE_URL}/chat?webmcp=off`, { waitUntil: "networkidle" });
    const offTools = await page.evaluate(() =>
      (window as never as { __standInHost: { getTools(): { name: string }[] } }).__standInHost
        .getTools()
        .map((t) => t.name),
    );
    expect(offTools, "no WebMCP tool is registered on the OFF page").toEqual([]);
    expect(await traceStates(page), "no trace rows on the OFF page").toEqual([]);
    await expect(page.locator("#chat-form"), "site remains usable").toBeVisible();
    await expect(page.locator('[data-testid="chat-thread"]')).toBeVisible();

    const offRead = await read();
    expect(offRead.returned, "visiting OFF neither destroys nor reseeds state").toBe(onBefore.returned);

    // Back to ON.
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => (window as never as { __natWebmcp: { registered: boolean } }).__natWebmcp?.registered === true, null, { timeout: 20_000 });
    const onAfter = await read();
    expect(onAfter.context.map((i: { asOf: string }) => i.asOf).sort()).toEqual(
      onBefore.context.map((i: { asOf: string }) => i.asOf).sort(),
    );
    console.log("[live][D] ON->OFF->ON preserved:", JSON.stringify(onAfter.context.map((i: {value:string}) => i.value)));
  });

  test("E: the capability is read-only — repeated reads change nothing", async ({ page, context }) => {
    await withStandIn(context);
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });

    const read = async () =>
      page.evaluate(async () => {
        const res = await fetch("/webmcp/support-context", { credentials: "same-origin" });
        return res.json();
      });

    const first = await read();
    for (let i = 0; i < 4; i += 1) {
      const again = await read();
      expect(again.returned).toBe(first.returned);
      expect(JSON.stringify(again.context)).toBe(JSON.stringify(first.context));
    }
    console.log("[live][E] 5 reads, identical payload, returned =", first.returned);
  });
});

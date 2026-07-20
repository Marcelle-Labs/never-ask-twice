import { test, expect, Page } from "@playwright/test";

/**
 * Never Ask Twice — demo driver (v2, reproduce-don't-assert).
 *
 * This does NOT read fixtures. Every checkpoint waits for a real response
 * from DEMO_BASE_URL (the Alibaba FC deployment) before advancing, and
 * asserts on the live payload so a broken deploy fails the recording rather
 * than producing a silently-wrong demo.
 *
 * Architecture note (see DISCOVERY.md): the /chat UI uses a cookie-based
 * visitor tenant that auto-seeds 4 Acme Robotics fixture facts. To demonstrate
 * a truly novel customer, the data flow is driven via POST /turn,
 * POST /sessions/:id/close, and POST /recall API calls with a custom tenant.
 * The UI is used for visual context (landing page, typing animation, /facts
 * dashboard). Every on-screen value rendered via DOM injection comes from a
 * live API response.
 *
 * Recording model: run with video on. Each checkpoint calls `mark()` which
 * pauses on a fully-rendered state. Capture is sliced into P1..P9 clips in
 * edit; narration N1..N9 is laid under the matching clip. See DEMO_KIT.md.
 *
 * Run:
 *   DEMO_BASE_URL=https://<your-fc-host>.fcapp.run \
 *   DEMO_CUSTOMER="Harptide Logistics" \
 *   npx playwright test demo.spec.ts --headed --project=chromium
 */

// Two hosts, deliberately.
//
// FC_BASE is the Alibaba Function Compute deployment. It runs the Qwen calls
// and owns the data flow — every fact on camera is distilled by FC.
//
// UI_BASE is the browsable host. Alibaba forces
// `Content-Disposition: attachment` on the default *.fcapp.run domain (their
// policy for the free subdomain), so a browser downloads FC responses instead
// of rendering them. That makes the FC host unrenderable on camera. Both hosts
// share one database — verified live — so the UI renders exactly the facts FC
// wrote. FC being live is proven on camera by the P9 curl card, not by the
// address bar.
const FC_BASE = process.env.DEMO_BASE_URL;
if (!FC_BASE) throw new Error("Set DEMO_BASE_URL to the FC endpoint.");
const UI_BASE = process.env.DEMO_UI_BASE_URL || FC_BASE;
const BASE = FC_BASE;

const CUSTOMER = process.env.DEMO_CUSTOMER || "Harptide Logistics";

// Custom tenant — provably never-seen. Derived from a timestamp so the
// on-camera tenant is unique per recording session.
const TENANT_SUFFIX = Date.now().toString(36);
const ACCOUNT_ID = `demo_${TENANT_SUFFIX}`;
const CUSTOMER_ID = `cust_${TENANT_SUFFIX}`;

// Hold times (ms) per checkpoint. Driven by actual audio durations from
// render_audio.mjs. Override with DEMO_HOLD_MS for all, or per-checkpoint
// via DEMO_HOLD_P1 etc. Defaults are generous for headroom.
const DEFAULT_HOLD = Number(process.env.DEMO_HOLD_MS || 5000);
function holdFor(cp: string): number {
  const envKey = `DEMO_HOLD_${cp}`;
  return Number(process.env[envKey]) || DEFAULT_HOLD;
}

async function mark(page: Page, id: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate((cp) => console.log(`[CHECKPOINT] ${cp}`), id);
  await page.waitForTimeout(holdFor(id));
}

// Inject an overlay div on the page to display live API values on camera.
// Every value shown comes from a real network response — no hardcoded data.
async function injectOverlay(page: Page, html: string) {
  await page.evaluate((content) => {
    let overlay = document.getElementById("demo-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "demo-overlay";
      overlay.style.cssText =
        "position:fixed;bottom:24px;left:24px;right:24px;" +
        "background:rgba(6,6,6,0.92);border:1px solid #1f1f22;border-radius:12px;" +
        "padding:20px 28px;font-family:'Geist Mono',ui-monospace,monospace;" +
        "font-size:14px;color:#F4F4F5;z-index:99999;line-height:1.6;" +
        "backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);";
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = content;
  }, html);
}

// Helper: make a POST request to the FC endpoint and return parsed JSON.
async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json();
}

test("never-ask-twice demo", async ({ page }) => {
  test.setTimeout(180_000);

  // -----------------------------------------------------------------------
  // P1 — Landing page.
  //
  // Gate the whole run on FC actually being live before a frame is recorded:
  // a broken FC deploy must fail the recording, not silently produce a demo
  // rendered entirely off the browsable host. This asserts on the live FC
  // /health payload, which is the same proof the P9 curl card shows on camera.
  // -----------------------------------------------------------------------
  const health = await (await fetch(`${FC_BASE}/health`)).json();
  expect(health.ok, "FC /health must be ok").toBe(true);
  expect(health.mode, "FC must be running Qwen live, not local-safe").toBe("qwen-live");
  expect(health.databaseConfigured, "FC must have a database").toBe(true);
  console.log(`[FC-PROOF] ${FC_BASE}/health -> ${JSON.stringify(health)}`);

  await page.goto(UI_BASE!, { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle(/Never Ask Twice/i);
  await mark(page, "P1");

  // -----------------------------------------------------------------------
  // P2 — First session: type as the invented customer, expect a clarifying ask
  //
  // The /chat UI seeds Acme facts for cookie-visitors, so we type for visual
  // effect but assert on a real POST /turn response with our custom tenant
  // that has zero prior facts. The agent must ask for missing facts.
  // -----------------------------------------------------------------------
  await page.goto(`${UI_BASE}/chat`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#user-input")).toBeVisible();

  // Must cover all four required predicates (sla_tier, product_config,
  // integration, escalation_contact). askedForMissingFacts stays true while
  // ANY required predicate is absent, so if the customer never names an
  // integration the agent keeps asking on every later session and the
  // "never asks twice" beat at P5 cannot hold. Verified live against FC:
  // this message distills to 4 facts and P5 comes back
  // askedForMissingFacts:false with 4 cited facts.
  const firstMsg =
    `Hi, I'm with ${CUSTOMER}. We're on the Gold SLA, we use single sign-on, ` +
    `our Salesforce integration is the one that keeps breaking, and our ` +
    `escalations go to our platform lead Dana Whitfield.`;

  // Type character-by-character for the camera (human-paced).
  const input = page.locator("#user-input");
  await input.click();
  await input.type(firstMsg, { delay: 35 });

  // Send the real turn via API with our custom tenant — no prior facts exist.
  const session1Id = `s1-${TENANT_SUFFIX}`;
  const turn1 = await apiPost("/turn", {
    accountId: ACCOUNT_ID,
    customerId: CUSTOMER_ID,
    sessionId: session1Id,
    role: "customer",
    message: firstMsg,
    memoryMode: "on",
  });

  // Assert: agent asked for missing facts (no prior memory for this tenant).
  expect(turn1.ok).toBe(true);
  expect(turn1.askedForMissingFacts).toBe(true);
  expect(turn1.answer).toBeTruthy();

  // Render the live response on-screen so the viewer sees the real answer.
  await injectOverlay(
    page,
    `<div style="color:#4ADE80;font-weight:600;margin-bottom:8px;">Agent reply (live POST /turn)</div>` +
    `<div style="color:#A1A1AA;">${turn1.answer}</div>` +
    `<div style="margin-top:8px;color:#8A8F98;">askedForMissingFacts: <span style="color:#4ADE80;">${turn1.askedForMissingFacts}</span></div>`,
  );

  await mark(page, "P2");

  // -----------------------------------------------------------------------
  // P3 — Close session, read the REAL distilled count (do not hardcode)
  //
  // Click the real Close session button for visual effect, but assert on
  // the actual POST /sessions/:id/close response with our custom tenant.
  // -----------------------------------------------------------------------
  // Click the UI button for camera (uses cookie-visitor tenant, but the
  // visual is what matters — the trace panel will show distillation).
  const closeBtn = page.locator("#close-session-btn");
  await expect(closeBtn).toBeVisible();
  await closeBtn.click();

  // Real close via API with our custom tenant.
  const closeRes = await apiPost(`/sessions/${session1Id}/close`, {
    accountId: ACCOUNT_ID,
    customerId: CUSTOMER_ID,
  });

  expect(closeRes.ok).toBe(true);
  expect(closeRes.distillationStatus).toBe("complete");
  // Read the real count — do NOT hardcode. Must be > 0 for the demo to proceed.
  const factsDistilled: number = closeRes.factsDistilled;
  expect(factsDistilled).toBeGreaterThan(0);

  // Wait for the UI trace to show the distillation result.
  await expect(
    page.locator("#trace-logs").getByText(/distillation complete/i),
  ).toBeVisible({ timeout: 30_000 });

  await injectOverlay(
    page,
    `<div style="color:#4ADE80;font-weight:600;margin-bottom:8px;">Session closed (live POST /sessions/:id/close)</div>` +
    `<div style="font-size:28px;font-weight:800;color:#4ADE80;">${factsDistilled} facts distilled</div>` +
    `<div style="margin-top:8px;color:#8A8F98;">distillationStatus: ${closeRes.distillationStatus}</div>`,
  );

  await mark(page, "P3");

  // -----------------------------------------------------------------------
  // P4 — Reveal the persisted structured facts (from real recall)
  //
  // Call POST /recall to get the actual fact bundle for our custom tenant.
  // Render the facts on-screen. These are the real persisted facts, not mocked.
  // -----------------------------------------------------------------------
  const recallRes = await apiPost("/recall", {
    accountId: ACCOUNT_ID,
    customerId: CUSTOMER_ID,
    sessionId: session1Id,
    query: "What do you know about this customer?",
  });

  expect(recallRes.ok).toBe(true);
  const semanticFacts = recallRes.bundle.filter(
    (item: { kind: string }) => item.kind === "semantic",
  );
  expect(semanticFacts.length).toBeGreaterThan(0);

  // Render the real facts on-screen.
  const factsHtml = semanticFacts
    .map(
      (f: { summary: string; score: number }) =>
        `<div style="padding:6px 0;border-bottom:1px solid #1f1f22;">` +
        `<span style="color:#4ADE80;">${f.summary}</span>` +
        ` <span style="color:#52525B;font-size:12px;">score: ${f.score.toFixed(3)}</span>` +
        `</div>`,
    )
    .join("");

  await injectOverlay(
    page,
    `<div style="color:#4ADE80;font-weight:600;margin-bottom:8px;">Recalled facts (live POST /recall — ${semanticFacts.length} semantic)</div>` +
    factsHtml,
  );

  await mark(page, "P4");

  // -----------------------------------------------------------------------
  // P5 — Second session, same customer, different question, NO re-ask
  //
  // New sessionId, same accountId/customerId. The agent should now have the
  // distilled facts in memory and should NOT ask for missing facts.
  // -----------------------------------------------------------------------
  const session2Id = `s2-${TENANT_SUFFIX}`;
  const secondMsg =
    `${CUSTOMER} again — a webhook started returning 500s this morning. ` +
    `What do you have on us?`;

  // Navigate to a fresh /chat page for the camera.
  //
  // Deliberately WITHOUT ?sessionId=session2Id. Loading /chat creates that
  // session under the page's cookie-visitor tenant; the API call below then
  // writes to the same id as our demo tenant and the ownership guard rejects
  // it with a 404 (correctly — that guard is the isolation this demo claims).
  // Letting the UI mint its own throwaway session keeps session2Id free for
  // the API, which is what actually drives the data.
  await page.goto(`${UI_BASE}/chat`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("#user-input")).toBeVisible();

  // Type for visual effect.
  const input2 = page.locator("#user-input");
  await input2.click();
  await input2.type(secondMsg, { delay: 35 });

  // Send the real turn via API — same tenant, new session.
  const turn2 = await apiPost("/turn", {
    accountId: ACCOUNT_ID,
    customerId: CUSTOMER_ID,
    sessionId: session2Id,
    role: "customer",
    message: secondMsg,
    memoryMode: "on",
  });

  expect(turn2.ok).toBe(true);
  // Key assertion: it should NOT ask for missing facts this time.
  expect(turn2.askedForMissingFacts).toBe(false);
  // It should have cited facts from memory.
  expect(turn2.citedFacts.length).toBeGreaterThan(0);
  expect(turn2.answer).toBeTruthy();

  await injectOverlay(
    page,
    `<div style="color:#4ADE80;font-weight:600;margin-bottom:8px;">Second session — agent already knows ${CUSTOMER} (live POST /turn)</div>` +
    `<div style="color:#A1A1AA;">${turn2.answer}</div>` +
    `<div style="margin-top:8px;color:#8A8F98;">askedForMissingFacts: <span style="color:#F4F4F5;">${turn2.askedForMissingFacts}</span> · citedFacts: <span style="color:#4ADE80;">${turn2.citedFacts.length}</span></div>`,
  );

  await mark(page, "P5");

  // -----------------------------------------------------------------------
  // P6 — Recall trace: real cited facts from the P5 response
  //
  // The citedFacts array from turn2 is the real cited payload. Render it.
  // -----------------------------------------------------------------------
  const citedHtml = turn2.citedFacts
    .map(
      (f: { summary: string; predicate: string; object: string }) =>
        `<div style="padding:6px 0;border-bottom:1px solid #1f1f22;">` +
        `<span style="color:#4ADE80;font-weight:600;">RECALL</span> ` +
        `<span style="color:#F4F4F5;">${f.predicate}</span>` +
        ` <span style="color:#A1A1AA;">&rarr; ${f.object}</span>` +
        ` <span style="color:#52525B;font-size:12px;">(${f.summary})</span>` +
        `</div>`,
    )
    .join("");

  await injectOverlay(
    page,
    `<div style="color:#4ADE80;font-weight:600;margin-bottom:8px;">Cited facts trace (from live POST /turn response)</div>` +
    citedHtml,
  );

  await mark(page, "P6");

  // -----------------------------------------------------------------------
  // P7a — Isolation: a foreign tenant sees nothing for this customer
  //
  // Call POST /recall with a different accountId. The bundle must be empty
  // because no facts exist for that tenant. This proves data-boundary isolation.
  // -----------------------------------------------------------------------
  const foreignAccount = `other_tenant_${TENANT_SUFFIX}`;
  const foreignRecall = await apiPost("/recall", {
    accountId: foreignAccount,
    customerId: `other_cust_${TENANT_SUFFIX}`,
    query: `What do you know about ${CUSTOMER}?`,
  });

  expect(foreignRecall.ok).toBe(true);
  expect(foreignRecall.bundle.length).toBe(0);

  await injectOverlay(
    page,
    `<div style="color:#4ADE80;font-weight:600;margin-bottom:8px;">Tenant isolation (live POST /recall — foreign accountId)</div>` +
    `<div style="font-size:20px;color:#F4F4F5;">bundle: <span style="color:#8A8F98;">[]</span> — ${foreignRecall.bundle.length} facts</div>` +
    `<div style="margin-top:8px;color:#8A8F98;">accountId: ${foreignAccount}</div>`,
  );

  await mark(page, "P7a");

  // -----------------------------------------------------------------------
  // P7b — Revoke a fact, show it gone from recall
  //
  // TODO: No HTTP endpoint or UI affordance exists for forget/revoke.
  // MemoryService.forget() is exposed via MCP stdio tools only, not HTTP.
  // The demo cannot demonstrate a live revoke action. The narration for P7
  // acknowledges "revocable" as a design property without showing it live.
  // See DISCOVERY.md and BUILD_REPORT.md for details.
  // -----------------------------------------------------------------------
  await injectOverlay(
    page,
    `<div style="color:#8A8F98;font-weight:600;margin-bottom:8px;">Revoke (design property — not demonstrated live)</div>` +
    `<div style="color:#52525B;">MemoryService.forget() exists but is MCP-only. No HTTP route or UI button.</div>`,
  );

  await mark(page, "P7b");

  // -----------------------------------------------------------------------
  // P8 — Hold on a clean governance summary frame (talking beat, no action)
  //
  // Navigate to /facts?tenant=eval-fixture to show the real fact store with
  // governance badges. This is the cookie-visitor's Acme facts — used as a
  // visual governance summary, not as the demo customer's data.
  // -----------------------------------------------------------------------
  await page.goto(`${UI_BASE}/facts?tenant=eval-fixture`, {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("heading", { name: /Semantic Fact Store/i }),
  ).toBeVisible();

  // Clear the overlay so the /facts page governance badges are visible.
  await page.evaluate(() => {
    const overlay = document.getElementById("demo-overlay");
    if (overlay) overlay.remove();
  });

  await mark(page, "P8");

  // -----------------------------------------------------------------------
  // P9 — Curl card overlay handled in edit; hold on a final clean frame
  //
  // Hold on the landing page. The curl card is burned in during ffmpeg
  // assembly (see curl-card.txt and assemble.mjs).
  // -----------------------------------------------------------------------
  await page.goto(UI_BASE!, { waitUntil: "domcontentloaded" });
  await mark(page, "P9");
});

import { test, expect } from "@playwright/test";

// Behavioral audit of the live /chat and /facts surfaces, ahead of the
// competition submission. Scoped strictly to this product's own routes —
// no external navigation. See conversation log for rationale.
//
// Scenario 5 deliberately never clicks "Close session" so edge-case/garbage
// input is never distilled into the acme_corp/jason_99 fact store that
// backs the live demo video.

const BASE_URL = process.env.DEMO_BASE_URL ?? "https://neverasktwice.dev";
const DEMO_PROMPT = "the integration is failing again, can you route this";

function trackTurnRequests(page: import("@playwright/test").Page) {
  const urls: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/turn")) urls.push(req.url());
  });
  return urls;
}

test.describe("Chat UI behavioral audit", () => {
  test.setTimeout(60_000);

  test("Scenario 1 — memory ON money shot", async ({ page }) => {
    const turnRequests = trackTurnRequests(page);

    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });

    const slaLine = await page.locator("nav .card").first().locator("div").nth(1).textContent();
    console.log("[audit][S1] Scenario panel SLA line:", slaLine);

    await expect(page.locator("#proof-card")).toBeVisible({ timeout: 15_000 });
    const memOn = await page.locator("#proof-mem-on").textContent();
    const memOff = await page.locator("#proof-mem-off").textContent();
    console.log(`[audit][S1] Proof card: with-memory=${memOn} without-memory=${memOff}`);

    const customerBefore = await page.locator("#chat-thread .message.customer").count();
    const agentBefore = await page.locator("#chat-thread .message.agent").count();

    await page.locator("#user-input").fill(DEMO_PROMPT);
    await page.getByRole("button", { name: "Send" }).click();

    const agentContent = page.locator("#chat-thread .message.agent .content").last();
    await expect(agentContent).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000); // let the 600ms recall-beat + chip glow settle

    const customerAfter = await page.locator("#chat-thread .message.customer").count();
    const agentAfter = await page.locator("#chat-thread .message.agent").count();
    const answerText = (await agentContent.textContent())?.trim();
    const chips = await page.locator(".recall-chip").allTextContents();
    const glowingRows = await page.locator("[data-trace-fact].recall-glow").count();

    console.log(`[audit][S1] /turn requests fired for this send: ${turnRequests.length}`);
    console.log(`[audit][S1] customer bubbles: ${customerBefore} -> ${customerAfter}`);
    console.log(`[audit][S1] agent bubbles: ${agentBefore} -> ${agentAfter}`);
    console.log("[audit][S1] Agent answer:", answerText);
    console.log("[audit][S1] Recall chips:", chips);
    console.log("[audit][S1] Glowing trace rows at moment of check:", glowingRows);

    expect(turnRequests.length, "exactly one /turn request per send").toBe(1);
    expect(customerAfter - customerBefore, "exactly one new customer bubble").toBe(1);
    expect(agentAfter - agentBefore, "exactly one new agent bubble").toBe(1);
    expect(answerText ?? "", "recalls SLA/integration/escalation without re-asking").not.toMatch(
      /what SLA tier.*configuration.*integration.*escalation/i,
    );
  });

  test("Scenario 2 — memory OFF control", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat?memory=off`, { waitUntil: "networkidle" });
    await expect(page.locator("#memory-status")).toHaveText(/Memory OFF/i);

    const prompts = [DEMO_PROMPT, "not sure where to find that", "still not sure"];
    const replies: string[] = [];

    for (const prompt of prompts) {
      const turnRequests = trackTurnRequests(page);
      await page.locator("#user-input").fill(prompt);
      await page.getByRole("button", { name: "Send" }).click();
      const agentContent = page.locator("#chat-thread .message.agent .content").last();
      await expect(agentContent).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      const text = (await agentContent.textContent())?.trim() ?? "";
      replies.push(text);
      console.log(`[audit][S2] turn ${replies.length}: requests=${turnRequests.length} reply="${text}"`);
    }

    const allIdentical = replies.every((r) => r === replies[0]);
    console.log("[audit][S2] All OFF replies identical word-for-word?", allIdentical);
    console.log("[audit][S2] Replies:", JSON.stringify(replies, null, 2));

    const snap = await (await page.request.get(`${BASE_URL}/eval-snapshot`)).json();
    console.log("[audit][S2] /eval-snapshot:", snap);
    console.log(
      "[audit][S2] memoryOnReaskRate === memoryOffReaskRate ?",
      snap.memoryOnReaskRate === snap.memoryOffReaskRate,
    );

    expect(allIdentical, "memory-OFF replies should vary, not read as a stuck loop").toBe(false);
  });

  test("Scenario 3a — close session before any message (fresh load)", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /close session/i }).click();
    await page.waitForTimeout(2_500);

    const traceText = await page.locator("#trace-logs").innerText();
    const errorRows = await page.locator("#trace-logs .trace-error").count();
    console.log("[audit][S3a] Trace panel after immediate close (0 messages):\n", traceText);
    console.log("[audit][S3a] Error-status trace rows:", errorRows);

    expect(errorRows, "closing an empty session should not surface an error").toBe(0);
  });

  test("Scenario 3b — one message then close", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    await page.locator("#user-input").fill(DEMO_PROMPT);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("#chat-thread .message.agent .content").last()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /close session/i }).click();
    await expect(page.locator("#trace-logs").getByText(/session closed/i)).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);

    const traceText = await page.locator("#trace-logs").innerText();
    console.log("[audit][S3b] Trace panel after 1-message close:\n", traceText);
  });

  test("Scenario 4 — Simulate Cold Start", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    const buttonTitle = await page.getByRole("button", { name: /simulate cold start/i }).getAttribute("title");
    console.log("[audit][S4] Button tooltip claims:", buttonTitle);

    await page.getByRole("button", { name: /simulate cold start/i }).click();
    await page.waitForLoadState("networkidle");

    const memStatus = await page.locator("#memory-status").textContent();
    const url = page.url();
    const traceText = await page.locator("#trace-logs").innerText();
    console.log("[audit][S4] URL after click:", url);
    console.log("[audit][S4] #memory-status after click:", memStatus);
    console.log("[audit][S4] Trace panel:\n", traceText);

    await page.locator("#user-input").fill(DEMO_PROMPT);
    await page.getByRole("button", { name: "Send" }).click();
    const agentContent = page.locator("#chat-thread .message.agent .content").last();
    await expect(agentContent).toBeVisible({ timeout: 30_000 });
    const text = await agentContent.textContent();
    console.log("[audit][S4] Reply after cold start:", text);
    console.log(
      "[audit][S4] Tooltip says 'memory store intact' (facts should still recall) — reply asks for missing context?",
      /what SLA tier|could you confirm|could you share/i.test(text ?? ""),
    );
  });

  test("Scenario 5 — edge inputs (no session close — protects prod fact store)", async ({ page }) => {
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });

    // Empty message — HTML5 `required` should block submission entirely.
    const bubblesBeforeEmpty = await page.locator("#chat-thread .message").count();
    await page.getByRole("button", { name: "Send" }).click();
    await page.waitForTimeout(500);
    const bubblesAfterEmpty = await page.locator("#chat-thread .message").count();
    console.log(`[audit][S5] Empty send: bubbles ${bubblesBeforeEmpty} -> ${bubblesAfterEmpty} (should be equal)`);

    // Very long message.
    const longMsg = "the integration keeps failing and ".repeat(150);
    await page.locator("#user-input").fill(longMsg);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.locator("#chat-thread .message.agent .content").last()).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: "test-results/audit-long-message.png", fullPage: true });
    console.log("[audit][S5] Long message (", longMsg.length, "chars) sent — screenshot saved, no crash");

    // HTML-like / injection-shaped content.
    const htmlMsg = `<b>test</b> "quoted" & <script>alert(1)</script>`;
    await page.locator("#user-input").fill(htmlMsg);
    await page.getByRole("button", { name: "Send" }).click();
    const lastCustomerBubble = page.locator("#chat-thread .message.customer").last();
    await expect(lastCustomerBubble).toBeVisible();
    const boldRendered = await lastCustomerBubble.locator("b").count();
    const scriptRendered = await lastCustomerBubble.locator("script").count();
    const renderedText = await lastCustomerBubble.locator(".content").textContent();
    console.log("[audit][S5] HTML-like input rendered as literal text:", renderedText);
    console.log("[audit][S5] Did <b> become a real bold element (bad)?", boldRendered > 0);
    console.log("[audit][S5] Did <script> become a real script element (XSS, very bad)?", scriptRendered > 0);
    await expect(page.locator("#chat-thread .message.agent .content").last()).toBeVisible({ timeout: 30_000 });

    expect(boldRendered, "customer input must be HTML-escaped, not rendered").toBe(0);
    expect(scriptRendered, "customer input must never execute as script").toBe(0);

    // Rapid double-send.
    const turnRequests = trackTurnRequests(page);
    const customerBefore = await page.locator("#chat-thread .message.customer").count();
    await page.locator("#user-input").fill("rapid double-send check");
    const sendBtn = page.getByRole("button", { name: "Send" });
    await Promise.all([sendBtn.click(), sendBtn.click()]);
    await page.waitForTimeout(3_000);
    const customerAfter = await page.locator("#chat-thread .message.customer").count();
    console.log(`[audit][S5] Rapid double-click: /turn requests fired=${turnRequests.length}, new customer bubbles=${customerAfter - customerBefore}`);

    expect(turnRequests.length, "double-click must not fire two /turn requests").toBe(1);
    expect(customerAfter - customerBefore, "double-click must not create duplicate bubbles").toBe(1);
  });

  test("Scenario 6 — manager dashboard vs chat consistency", async ({ page }) => {
    await page.goto(`${BASE_URL}/facts`, { waitUntil: "networkidle" });
    const headline = await page.locator("main .card").first().innerText();
    const factCards = await page.locator('[data-testid="fact-store"] .card').count();
    console.log("[audit][S6] Dashboard headline:", headline);
    console.log("[audit][S6] Fact cards shown:", factCards);

    const snap = await (await page.request.get(`${BASE_URL}/eval-snapshot`)).json();
    console.log("[audit][S6] /eval-snapshot:", snap);

    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    await expect(page.locator("#proof-card")).toBeVisible({ timeout: 15_000 });
    const chatMemOn = Number(await page.locator("#proof-mem-on").textContent());
    const chatMemOff = Number(await page.locator("#proof-mem-off").textContent());
    console.log(`[audit][S6] Chat proof card: on=${chatMemOn} off=${chatMemOff}`);

    expect(chatMemOn).toBeCloseTo(snap.memoryOnReaskRate, 2);
    expect(chatMemOff).toBeCloseTo(snap.memoryOffReaskRate, 2);
    expect(factCards, "dashboard should show the same fact count as eval-snapshot").toBe(snap.factsCount);
  });
});

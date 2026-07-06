import { chromium, expect } from "@playwright/test";

const BASE_URL = process.env.DEMO_BASE_URL ?? "https://neverasktwice.dev";
const WINDOW_POSITION = process.env.DEMO_WINDOW_POSITION ?? "0,0";
const DEMO_PROMPT = "the integration is failing again, can you route this";
const SETUP_MESSAGE =
  "We're Acme Robotics. Our SLA tier is gold, our product config requires SSO, the failing integration is Salesforce, and our escalation contact is Priya.";

const ACCOUNT_ID = "acme_corp";
const CUSTOMER_ID = "jason_99";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureSeeded() {
  const res = await fetch(`${BASE_URL}/eval-snapshot`);
  if (!res.ok) throw new Error(`eval-snapshot failed: HTTP ${res.status}`);
  const snap = await res.json();
  if (snap.factsCount > 0 && snap.missingPredicates.length === 0) return;

  const sessionId = `seed-${Date.now()}`;
  const turnRes = await fetch(`${BASE_URL}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      sessionId,
      role: "customer",
      message: SETUP_MESSAGE,
      memoryMode: "on",
    }),
  });
  if (!turnRes.ok) throw new Error(`seed turn failed: HTTP ${turnRes.status}`);

  const closeRes = await fetch(`${BASE_URL}/sessions/${sessionId}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID }),
  });
  if (!closeRes.ok) throw new Error(`seed close failed: HTTP ${closeRes.status}`);
  console.log("[record-demo] Seed session closed — polling for distillation to land...");

  // Distillation is fire-and-forget (canon §5.2). A 200 on /close does NOT
  // guarantee the semantic facts are written yet. Poll until they're present
  // so we never start filming with an empty memory store.
  for (let i = 0; i < 20; i++) {
    const s = await (await fetch(`${BASE_URL}/eval-snapshot`)).json();
    if (s.factsCount > 0 && s.missingPredicates.length === 0) {
      console.log(`[record-demo] Facts confirmed (${s.factsCount} facts, 0 missing) after ${i + 1}s`);
      return;
    }
    await wait(1_000);
  }
  throw new Error("seed distillation never landed — aborting record");
}

async function main() {
  await ensureSeeded();

  const browser = await chromium.launch({
    headless: false,
    slowMo: 150,
    args: [
      "--window-size=1920,1080",
      "--force-device-scale-factor=1",
      `--window-position=${WINDOW_POSITION}`,
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    // 0:00–0:08 Landing (was 15s — title card doesn't need more)
    console.log("[record-demo] Landing page");
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await wait(8_000);

    // 0:08–0:16 Enter chat (was 10s hold)
    console.log("[record-demo] Entering chat");
    const demoLink = page.getByRole("link", { name: /live demo/i }).first();
    if (await demoLink.isVisible().catch(() => false)) {
      await demoLink.click();
    } else {
      await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    }
    await expect(page.locator("#memory-status")).toHaveText(/Memory ON/i, { timeout: 15_000 });
    await wait(8_000);

    // 0:16–0:24 Establish memory-on state (was 15s — 3+2+3 is enough for eye guidance)
    console.log("[record-demo] Memory ON establishing");
    await page.mouse.move(940, 100);
    await wait(3_000);
    await page.mouse.move(170, 300);
    await wait(2_000);
    await page.mouse.move(980, 300);
    await wait(3_000);

    // 0:24–0:25 Send request
    console.log("[record-demo] Sending demo prompt (memory ON)");
    const input = page.locator("#user-input");
    await input.fill(DEMO_PROMPT);
    await wait(1_000);
    await page.getByRole("button", { name: "Send" }).click();

    // 0:25–0:45 Show memory recall (was 19s hold — 7+13 is enough for the money shot)
    console.log("[record-demo] Waiting for memory recall");
    await expect(page.locator('#chat-thread .message.agent .content').getByText(/priya/i).first()).toBeVisible({ timeout: 30_000 });

    // Anchor: the SAME selector must be non-zero on the ON side, or it's
    // matching nothing and the OFF-side toBe(0) is a vacuous pass.
    const onChips = await page.locator('.recall-chip').count();
    console.log(`[record-demo] Memory-ON recall chips: ${onChips} (must be > 0)`);
    expect(onChips, "memory ON must produce recall chips — else the selector is wrong").toBeGreaterThan(0);

    await page.mouse.move(600, 430);
    await wait(7_000);
    await page.mouse.move(980, 430);
    await wait(13_000);

    // 0:45–0:55 Close session / distillation (was 18s hold — 10s is enough)
    console.log("[record-demo] Closing session for distillation");
    await page.getByRole("button", { name: /close session/i }).click();
    await expect(page.locator('#trace-logs').getByText(/session closed/i)).toBeVisible({
      timeout: 20_000,
    });
    // Production shows different trace messages depending on whether
    // factsDistilled > 0. Use broad patterns that match both paths (same
    // reasoning as tests/demo-preflight.spec.ts).
    await expect(page.locator('#trace-logs').getByText(/distillation complete/i)).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.locator('#trace-logs').getByText(/semantic fact\(s\) written|no new facts/i),
    ).toBeVisible();
    await page.mouse.move(985, 520);
    await wait(10_000);

    // 0:55–1:03 Memory off (was 10s hold — 8s is enough)
    console.log("[record-demo] Switching to memory OFF");
    await page.goto(`${BASE_URL}/chat?memory=off`, { waitUntil: "networkidle" });
    await expect(page.locator("#memory-status")).toHaveText(/Memory OFF/i, { timeout: 15_000 });
    await wait(8_000);

    // 1:03–1:04 Send same request
    console.log("[record-demo] Sending demo prompt (memory OFF)");
    const offInput = page.locator("#user-input");
    await offInput.fill(DEMO_PROMPT);
    await wait(1_000);
    await page.getByRole("button", { name: "Send" }).click();

    // 1:04–1:24 Show memory-off contrast (was 20s hold — 7+13 matches ON side)
    // Structural signal: wait for agent reply to appear, then assert ZERO
    // recall chips. This proves the ablation without depending on Qwen's
    // exact phrasing — "sla tier" is brittle, "no recall chips" is structural.
    console.log("[record-demo] Waiting for memory-off contrast");
    await expect(page.locator('#chat-thread .message.agent .content').last()).toBeVisible({ timeout: 30_000 });
    const offRecallChips = await page.locator('.recall-chip').count();
    console.log(`[record-demo] Memory-OFF recall chips: ${offRecallChips} (must be 0)`);
    expect(offRecallChips, "memory OFF must produce zero recall chips").toBe(0);
    await page.mouse.move(600, 430);
    await wait(7_000);
    await page.mouse.move(985, 430);
    await wait(13_000);

    // 1:24–1:34 Facts dashboard (was 15s — 4+6 is enough)
    console.log("[record-demo] Facts dashboard");
    await page.goto(`${BASE_URL}/facts`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /semantic fact store/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.mouse.move(350, 300);
    await wait(4_000);
    await page.mouse.move(700, 500);
    await wait(6_000);

    // Hold final frame (was 5s — 3s is enough)
    console.log("[record-demo] Holding final frame");
    await wait(3_000);
  } finally {
    await browser.close();
  }
  console.log("[record-demo] Done");
}

main().catch(async (error) => {
  console.error("[record-demo] Failed:", error);
  process.exit(1);
});

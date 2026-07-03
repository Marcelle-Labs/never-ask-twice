import { chromium, expect } from "@playwright/test";

const BASE_URL = process.env.DEMO_BASE_URL ?? "https://neverasktwice.dev";
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
  console.log("[record-demo] Seeded semantic facts for demo account");
}

async function main() {
  await ensureSeeded();

  const browser = await chromium.launch({
    headless: false,
    slowMo: 150,
    args: ["--window-size=1920,1080"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

  // 0:00–0:15 Landing
  console.log("[record-demo] Landing page");
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await wait(15_000);

  // 0:15–0:25 Enter chat
  console.log("[record-demo] Entering chat");
  const demoLink = page.getByRole("link", { name: /live demo/i }).first();
  if (await demoLink.isVisible().catch(() => false)) {
    await demoLink.click();
  } else {
    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
  }
  await expect(page.locator("#memory-status")).toHaveText(/Memory ON/i, { timeout: 15_000 });
  await wait(10_000);

  // 0:25–0:40 Establish memory-on state
  console.log("[record-demo] Memory ON establishing");
  await page.mouse.move(940, 100);
  await wait(2_000);
  await page.mouse.move(170, 300);
  await wait(3_000);
  await page.mouse.move(980, 300);
  await wait(10_000);

  // 0:40–0:55 Send request
  console.log("[record-demo] Sending demo prompt (memory ON)");
  const input = page.locator("#user-input");
  await input.fill(DEMO_PROMPT);
  await wait(1_000);
  await page.getByRole("button", { name: "Send" }).click();

  // 0:55–1:25 Show memory recall
  console.log("[record-demo] Waiting for memory recall");
  await expect(page.locator('[data-testid="chat-thread"] .message.agent .content').getByText(/priya/i).first()).toBeVisible({ timeout: 30_000 });
  await page.mouse.move(600, 430);
  await wait(7_000);
  await page.mouse.move(980, 430);
  await wait(12_000);

  // 1:25–1:55 Close session / distillation
  console.log("[record-demo] Closing session for distillation");
  await page.getByRole("button", { name: /close session/i }).click();
  await expect(page.locator('[data-testid="memory-trace"]').getByText(/session closed/i)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid="memory-trace"]').getByText(/qwen distillation complete/i)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.locator('[data-testid="memory-trace"]').getByText(/semantic fact\(s\) written|no new facts/i),
  ).toBeVisible();
  await expect(page.locator('[data-testid="memory-trace"]').getByText(/supersession check/i)).toBeVisible();
  await page.mouse.move(985, 520);
  await wait(18_000);

  // 1:55–2:05 Memory off
  console.log("[record-demo] Switching to memory OFF");
  await page.goto(`${BASE_URL}/chat?memory=off`, { waitUntil: "networkidle" });
  await expect(page.locator("#memory-status")).toHaveText(/Memory OFF/i, { timeout: 15_000 });
  await wait(10_000);

  // 2:05–2:20 Send same request
  console.log("[record-demo] Sending demo prompt (memory OFF)");
  const offInput = page.locator("#user-input");
  await offInput.fill(DEMO_PROMPT);
  await wait(1_000);
  await page.getByRole("button", { name: "Send" }).click();

  // 2:20–2:40 Show memory-off contrast
  console.log("[record-demo] Waiting for memory-off contrast");
  await expect(page.locator('[data-testid="chat-thread"] .message.agent .content').getByText(/sla tier/i)).toBeVisible({ timeout: 30_000 });
  await page.mouse.move(600, 430);
  await wait(8_000);
  await page.mouse.move(985, 430);
  await wait(12_000);

  // 2:40–2:55 Facts dashboard
  console.log("[record-demo] Facts dashboard");
  await page.goto(`${BASE_URL}/facts`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: /semantic fact store/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.mouse.move(350, 300);
  await wait(5_000);
  await page.mouse.move(700, 500);
  await wait(10_000);

  // Hold final frame
  console.log("[record-demo] Holding final frame");
  await wait(5_000);
  } finally {
    await browser.close();
  }
  console.log("[record-demo] Done");
}

main().catch(async (error) => {
  console.error("[record-demo] Failed:", error);
  process.exit(1);
});

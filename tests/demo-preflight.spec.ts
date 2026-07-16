import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.DEMO_BASE_URL ?? "https://neverasktwice.dev";
const DEMO_PROMPT = "the integration is failing again, can you route this";
const SETUP_MESSAGE =
  "We're Acme Robotics. Our SLA tier is gold, our product config requires SSO, the failing integration is Salesforce, and our escalation contact is Priya.";

const ACCOUNT_ID = "acme_corp";
const CUSTOMER_ID = "jason_99";

test.describe("Never Ask Twice — live demo preflight", () => {
  test.setTimeout(120_000);

  test("health check — deployment is up and qwen-live", async ({ page }) => {
    const res = await page.request.get(`${BASE_URL}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mode).toBe("qwen-live");
    expect(body.databaseConfigured).toBe(true);
  });

  test("seed — ensure semantic facts exist for demo account", async ({ page }) => {
    const snap = await (await page.request.get(`${BASE_URL}/eval-snapshot?tenant=eval-fixture`)).json();
    if (snap.factsCount > 0 && snap.missingPredicates.length === 0) {
      test.skip(true, "Facts already seeded — skipping seed step");
      return;
    }

    const sessionId = `seed-${Date.now()}`;
    const turnRes = await page.request.post(`${BASE_URL}/turn`, {
      data: {
        accountId: ACCOUNT_ID,
        customerId: CUSTOMER_ID,
        sessionId,
        role: "customer",
        message: SETUP_MESSAGE,
        memoryMode: "on",
      },
    });
    expect(turnRes.ok()).toBeTruthy();
    const closeRes = await page.request.post(`${BASE_URL}/sessions/${sessionId}/close`, {
      data: { accountId: ACCOUNT_ID, customerId: CUSTOMER_ID },
    });
    expect(closeRes.ok()).toBeTruthy();
    const closeBody = await closeRes.json();
    expect(closeBody.distillationStatus).toBe("complete");

    const verify = await (await page.request.get(`${BASE_URL}/eval-snapshot?tenant=eval-fixture`)).json();
    expect(verify.missingPredicates.length).toBe(0);
    expect(verify.memoryOnReaskRate).toBe(0);
  });

  test("memory ON — recalls Salesforce / SSO / Gold / Priya", async ({ page }) => {
    const chat = page.locator('#chat-thread');
    const agentContent = chat.locator('.message.agent .content');

    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });
    await expect(page.locator("#memory-status")).toHaveText(/Memory ON/i);

    await expect(page.locator("#proof-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#proof-mem-on")).toHaveText("0.00");
    await expect(page.locator("#proof-mem-off")).toHaveText("1.00");

    const input = page.locator("#user-input");
    await input.fill(DEMO_PROMPT);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(agentContent.getByText(/salesforce/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(agentContent.getByText(/\bsso\b/i).first()).toBeVisible();
    await expect(agentContent.getByText(/gold/i).first()).toBeVisible();
    await expect(agentContent.getByText(/priya/i).first()).toBeVisible();

    await expect(
      agentContent.getByText(/what SLA tier.*configuration.*integration.*escalation/i),
    ).not.toBeVisible();
  });

  test("facts dashboard — semantic facts and provenance", async ({ page }) => {
    await page.goto(`${BASE_URL}/facts`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: /semantic fact store/i })).toBeVisible();
    await expect(page.getByText(/priya/i)).toBeVisible();
    await expect(page.getByText(/salesforce/i)).toBeVisible();
    await expect(page.getByText(/\bsso\b/i)).toBeVisible();
    await expect(page.getByText(/gold/i)).toBeVisible();
    await expect(page.getByText(/repeat-question rate/i)).toBeVisible();
  });

  test("session close — distillation and write-path events", async ({ page }) => {
    const chat = page.locator('#chat-thread');
    const trace = page.locator('#trace-logs');

    await page.goto(`${BASE_URL}/chat`, { waitUntil: "networkidle" });

    const input = page.locator("#user-input");
    await input.fill(DEMO_PROMPT);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(chat.getByText(/priya/i)).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /close session/i }).click();

    await expect(trace.getByText(/session closed/i)).toBeVisible({
      timeout: 20_000,
    });
    // Production shows different trace messages depending on whether
    // factsDistilled > 0. Use broad patterns that match both paths.
    await expect(trace.getByText(/distillation complete/i)).toBeVisible();
    await expect(
      trace.getByText(/semantic fact\(s\) written|no new facts/i),
    ).toBeVisible();
  });

  test("memory OFF — asks for missing context", async ({ page }) => {
    const chat = page.locator('#chat-thread');
    const agentContent = chat.locator('.message.agent .content');
    const trace = page.locator('#trace-logs');

    await page.goto(`${BASE_URL}/chat?memory=off`, { waitUntil: "networkidle" });
    await expect(page.locator("#memory-status")).toHaveText(/Memory OFF/i);

    const input = page.locator("#user-input");
    await input.fill(DEMO_PROMPT);
    await page.getByRole("button", { name: "Send" }).click();

    await expect(agentContent.getByText(/sla tier/i)).toBeVisible({ timeout: 30_000 });
    await expect(agentContent.getByText(/configuration/i)).toBeVisible();
    await expect(agentContent.getByText(/integration/i)).toBeVisible();
    await expect(agentContent.getByText(/escalation contact/i)).toBeVisible();

    await expect(
      trace.getByText(/no prior facts|memory off/i),
    ).toBeVisible();
  });

});

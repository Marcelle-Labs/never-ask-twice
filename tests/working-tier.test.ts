import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("working-tier", () => {
  it("uses an in-session stated fact pre-distillation", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("Which integration is failing?", 11);
    const service = new MemoryService(new InMemoryMemoryStore(), qwen);

    await service.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });
    service.rememberWorkingFact({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: "sess-1",
      observedAt: new Date("2026-06-25T10:00:00.000Z"),
      candidate: {
        subject: "Acme",
        predicate: "integration",
        predicateClass: "configuration",
        object: "Salesforce",
        confidence: 0.8,
        metadata: {},
      },
    });

    const recall = await service.recall({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: "sess-1",
      query: "Which integration is failing?",
      tokenBudget: 1200,
      now: new Date("2026-06-25T10:10:00.000Z"),
    });

    expect(recall.bundle.some((item) => item.kind === "working" && item.summary.includes("Salesforce"))).toBe(true);
  });
});

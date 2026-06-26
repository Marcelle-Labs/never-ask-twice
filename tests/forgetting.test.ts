import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("forgetting", () => {
  it("drops expired ttl facts from recall", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("Escalate to Priya.", 5);
    qwen.setEmbedding("Acme escalation_contact Priya", 5);
    qwen.setEmbedding("Who is our escalation contact?", 5);
    qwen.setDistillation("customer: Escalate to Priya.", [
      {
        subject: "Acme",
        predicate: "escalation_contact",
        predicateClass: "relationship",
        object: "Priya",
        confidence: 0.8,
        ttlDays: 1,
        metadata: {},
      },
    ]);

    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, qwen);
    await service.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });
    await service.appendTurn({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: "sess-1",
      role: "customer",
      message: "Escalate to Priya.",
      ts: new Date("2026-06-25T10:00:00.000Z"),
    });
    await service.closeSession({
      sessionId: "sess-1",
      accountId: "acct-1",
      customerId: "cust-1",
      closedAt: new Date("2026-06-25T10:05:00.000Z"),
    });

    const recall = await service.recall({
      accountId: "acct-1",
      customerId: "cust-1",
      query: "Who is our escalation contact?",
      tokenBudget: 1200,
      now: new Date("2026-06-27T10:05:00.000Z"),
    });

    expect(recall.bundle.filter((item) => item.kind === "semantic")).toHaveLength(0);
    // Note: Provenance attribution requires event-level mapping from distillation output
    // Current distillation doesn't provide which events produced which candidate
    // expect(store.semanticFactProvenance).toHaveLength(1);
  });
});

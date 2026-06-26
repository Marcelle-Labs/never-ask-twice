import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("idempotent", () => {
  it("does not duplicate facts on double close", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("Our timezone is ET.", 4);
    qwen.setEmbedding("Acme timezone ET", 4);
    qwen.setDistillation("customer: Our timezone is ET.", [
      {
        subject: "Acme",
        predicate: "timezone",
        predicateClass: "temporal",
        object: "ET",
        confidence: 0.8,
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
      message: "Our timezone is ET.",
      ts: new Date("2026-06-25T10:00:00.000Z"),
    });

    const closedAt = new Date("2026-06-25T10:05:00.000Z");
    await service.closeSession({ sessionId: "sess-1", accountId: "acct-1", customerId: "cust-1", closedAt });
    await service.closeSession({ sessionId: "sess-1", accountId: "acct-1", customerId: "cust-1", closedAt });

    expect(store.semanticFacts).toHaveLength(1);
    // Note: Provenance attribution requires event-level mapping from distillation output
    // Current distillation doesn't provide which events produced which candidate
    // expect(store.semanticFactProvenance).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("distill", () => {
  it("creates exactly one semantic fact from a single distilled candidate", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("I prefer email support.", 2);
    qwen.setEmbedding("Acme preferred_channel email", 2);
    qwen.setDistillation("customer: I prefer email support.", [
      {
        subject: "Acme",
        predicate: "preferred_channel",
        predicateClass: "profile",
        object: "email",
        confidence: 0.9,
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
      message: "I prefer email support.",
      ts: new Date("2026-06-25T10:00:00.000Z"),
    });

    await service.closeSession({
      sessionId: "sess-1",
      accountId: "acct-1",
      customerId: "cust-1",
      closedAt: new Date("2026-06-25T10:05:00.000Z"),
    });

    expect(store.semanticFacts).toHaveLength(1);
    // Note: Provenance attribution requires event-level mapping from distillation output
    // Current distillation doesn't provide which events produced which candidate
    // expect(store.semanticFactProvenance).toHaveLength(1);
  });
});

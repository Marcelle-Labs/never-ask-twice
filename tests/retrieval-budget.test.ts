import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("retrieval-budget", () => {
  it("keeps the serialized bundle under the token budget on every call", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("billing question", 7);
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, qwen);

    store.insertSemanticFact({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: null,
      subject: "Acme",
      predicate: "sla_tier",
      predicateClass: "contract",
      object: "gold-with-24x7-and-priority-billing-support",
      confidence: 0.9,
      adjudicationRationale: null,
      validFrom: new Date("2026-06-25T10:00:00.000Z"),
      validTo: null,
      expiresAt: null,
      supersededBy: null,
      metadata: {},
      embedding: Array.from({ length: 1024 }, (_, index) => (index === 7 ? 1 : 0)),
    });

    const recall = await service.recall({
      accountId: "acct-1",
      customerId: "cust-1",
      query: "billing question",
      tokenBudget: 8,
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(recall.usedTokens).toBeLessThanOrEqual(8);
  });
});

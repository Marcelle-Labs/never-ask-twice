import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("retrieval-relevance", () => {
  it("surfaces billing facts above unrelated facts", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("billing issue", 9);
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, qwen);

    store.insertSemanticFact({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: null,
      subject: "Acme",
      predicate: "sla_tier",
      predicateClass: "contract",
      object: "gold",
      confidence: 0.9,
      adjudicationRationale: null,
      validFrom: new Date("2026-06-25T10:00:00.000Z"),
      validTo: null,
      expiresAt: null,
      supersededBy: null,
      metadata: {},
      embedding: Array.from({ length: 1024 }, (_, index) => (index === 9 ? 1 : 0)),
    });
    store.insertSemanticFact({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: null,
      subject: "Acme",
      predicate: "timezone",
      predicateClass: "temporal",
      object: "PT",
      confidence: 0.95,
      adjudicationRationale: null,
      validFrom: new Date("2026-06-25T10:00:00.000Z"),
      validTo: null,
      expiresAt: null,
      supersededBy: null,
      metadata: {},
      embedding: Array.from({ length: 1024 }, (_, index) => (index === 3 ? 1 : 0)),
    });

    const recall = await service.recall({
      accountId: "acct-1",
      customerId: "cust-1",
      query: "billing issue",
      tokenBudget: 1200,
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(recall.bundle[0]?.summary).toContain("sla_tier");
  });
});

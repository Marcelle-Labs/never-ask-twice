import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("tenant-scope", () => {
  it("never returns memories outside the requested tenant", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("show the support plan", 13);
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, qwen);

    store.insertSemanticFact({
      accountId: "acct-2",
      customerId: "cust-2",
      sessionId: null,
      subject: "Globex",
      predicate: "product_plan",
      predicateClass: "contract",
      object: "enterprise",
      confidence: 0.9,
      adjudicationRationale: null,
      validFrom: new Date("2026-06-25T10:00:00.000Z"),
      validTo: null,
      expiresAt: null,
      supersededBy: null,
      metadata: {},
      embedding: Array.from({ length: 1024 }, (_, index) => (index === 13 ? 1 : 0)),
    });

    const recall = await service.recall({
      accountId: "acct-1",
      customerId: "cust-1",
      query: "show the support plan",
      tokenBudget: 1200,
      now: new Date("2026-06-25T12:00:00.000Z"),
    });

    expect(recall.bundle).toHaveLength(0);
  });
});

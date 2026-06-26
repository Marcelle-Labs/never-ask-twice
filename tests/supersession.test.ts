import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("supersession", () => {
  it("supersedes the prior fact when a preference changes", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("Use email.", 1);
    qwen.setEmbedding("Use phone.", 2);
    qwen.setEmbedding("Acme preferred_channel email", 1);
    qwen.setEmbedding("Acme preferred_channel phone", 2);
    qwen.setDistillation("customer: Use email.", [
      {
        subject: "Acme",
        predicate: "preferred_channel",
        predicateClass: "profile",
        object: "email",
        confidence: 0.9,
        metadata: {},
      },
    ]);
    qwen.setDistillation("customer: Use phone.", [
      {
        subject: "Acme",
        predicate: "preferred_channel",
        predicateClass: "profile",
        object: "phone",
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
      message: "Use email.",
      ts: new Date("2026-06-25T10:00:00.000Z"),
    });
    await service.closeSession({
      sessionId: "sess-1",
      accountId: "acct-1",
      customerId: "cust-1",
      closedAt: new Date("2026-06-25T10:05:00.000Z"),
    });

    await service.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-2" });
    await service.appendTurn({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: "sess-2",
      role: "customer",
      message: "Use phone.",
      ts: new Date("2026-06-26T10:00:00.000Z"),
    });
    await service.closeSession({
      sessionId: "sess-2",
      accountId: "acct-1",
      customerId: "cust-1",
      closedAt: new Date("2026-06-26T10:05:00.000Z"),
    });

    const current = store.semanticFacts.filter((fact) => fact.validTo === null);
    const superseded = store.semanticFacts.filter((fact) => fact.validTo !== null);

    expect(current).toHaveLength(1);
    expect(superseded).toHaveLength(1);
    expect(superseded[0]?.supersededBy).toBe(current[0]?.factId);
  });
});

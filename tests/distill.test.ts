import { describe, expect, it } from "vitest";

import type { DistilledFactCandidate } from "../src/contracts.js";
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
    // 1 event × 1 fact = 1 session-level provenance row
    expect(store.semanticFactProvenance).toHaveLength(1);
    expect(store.semanticFactProvenance[0].weight).toBe(1);
    expect(store.semanticFactProvenance[0].rationale).toBe("session-level attribution");
  });

  it("drops a candidate with an out-of-enum predicate instead of crashing the whole close", async () => {
    // Regression: live Qwen distillation returned a "customer_name" candidate alongside a
    // valid one. MemoryPredicateSchema doesn't include "customer_name" — the strict
    // DistilledFactCandidate type can't express that, so it's forced through with a cast,
    // the same way a real (untyped) Qwen response would arrive.
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("We're Acme Robotics, our SLA tier is gold.", 2);
    qwen.setEmbedding("Acme sla_tier gold", 2);
    qwen.setDistillation("customer: We're Acme Robotics, our SLA tier is gold.", [
      {
        subject: "Acme",
        predicate: "customer_name",
        predicateClass: "profile",
        object: "Acme Robotics",
        confidence: 0.9,
        metadata: {},
      } as unknown as DistilledFactCandidate,
      {
        subject: "Acme",
        predicate: "sla_tier",
        predicateClass: "profile",
        object: "gold",
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
      message: "We're Acme Robotics, our SLA tier is gold.",
      ts: new Date("2026-06-25T10:00:00.000Z"),
    });

    await expect(
      service.closeSession({
        sessionId: "sess-1",
        accountId: "acct-1",
        customerId: "cust-1",
        closedAt: new Date("2026-06-25T10:05:00.000Z"),
      })
    ).resolves.toBeDefined();

    expect(store.semanticFacts).toHaveLength(1);
    expect(store.semanticFacts[0].predicate).toBe("sla_tier");
  });
});

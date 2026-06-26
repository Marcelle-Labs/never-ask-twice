import { describe, expect, it } from "vitest";

import { runSupportTurn } from "../src/agent/supportAgent.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("agent-loop", () => {
  it("runs the support flow end to end with no re-ask in session 2 when memory is on", async () => {
    const qwen = new FakeQwenClient();
    const setup =
      "Our SLA tier is gold, the product config requires SSO, the failing integration is Salesforce, and the escalation contact is Priya.";
    const followUp = "Can you route the Salesforce outage without making me repeat the setup?";

    qwen.setEmbedding(setup, 31);
    qwen.setEmbedding(followUp, 32);
    qwen.setEmbedding("Acme sla_tier gold", 33);
    qwen.setEmbedding("Acme product_config requires SSO", 34);
    qwen.setEmbedding("Acme integration Salesforce", 35);
    qwen.setEmbedding("Acme escalation_contact Priya", 36);
    qwen.setDistillation(`customer: ${setup}`, [
      {
        subject: "Acme",
        predicate: "sla_tier",
        predicateClass: "contract",
        object: "gold",
        confidence: 0.9,
        metadata: {},
      },
      {
        subject: "Acme",
        predicate: "product_config",
        predicateClass: "configuration",
        object: "requires SSO",
        confidence: 0.9,
        metadata: {},
      },
      {
        subject: "Acme",
        predicate: "integration",
        predicateClass: "configuration",
        object: "Salesforce",
        confidence: 0.9,
        metadata: {},
      },
      {
        subject: "Acme",
        predicate: "escalation_contact",
        predicateClass: "relationship",
        object: "Priya",
        confidence: 0.9,
        metadata: {},
      },
    ]);

    const memoryService = new MemoryService(new InMemoryMemoryStore(), qwen);
    await memoryService.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });
    await memoryService.appendTurn({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: "sess-1",
      role: "customer",
      message: setup,
      ts: new Date("2026-06-25T09:00:00.000Z"),
    });
    await memoryService.closeSession({
      sessionId: "sess-1",
      accountId: "acct-1",
      customerId: "cust-1",
      closedAt: new Date("2026-06-25T09:05:00.000Z"),
    });

    await memoryService.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-2" });
    const response = await runSupportTurn({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: "sess-2",
      query: followUp,
      memoryMode: "on",
      memoryService,
      now: new Date("2026-06-26T09:00:00.000Z"),
    });

    expect(response.askedForMissingFacts).toBe(false);
    expect(response.answer).toContain("Routing this to the documented escalation contact now.");
  });
});

import { MemoryService } from "../memory/service.js";
import { InMemoryMemoryStore } from "../memory/store.js";
import { FakeQwenClient } from "../testing/fakeQwenClient.js";

export interface McpRuntime {
  memoryService: MemoryService;
  sessionIndex: Map<string, { accountId: string; customerId: string }>;
}

export async function createSeededMcpRuntime() {
  const qwen = new FakeQwenClient();
  const setup =
    "Our SLA tier is gold, the product config requires SSO, the failing integration is Salesforce, and the escalation contact is Priya.";
  const followUp = "Can you route the Salesforce outage without making me repeat the setup?";

  qwen.setEmbedding(setup, 41);
  qwen.setEmbedding(followUp, 42);
  qwen.setEmbedding("Acme sla_tier gold", 43);
  qwen.setEmbedding("Acme product_config requires SSO", 44);
  qwen.setEmbedding("Acme integration Salesforce", 45);
  qwen.setEmbedding("Acme escalation_contact Priya", 46);
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
  const sessionIndex = new Map<string, { accountId: string; customerId: string }>();

  await memoryService.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });
  sessionIndex.set("sess-1", { accountId: "acct-1", customerId: "cust-1" });
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
  sessionIndex.set("sess-2", { accountId: "acct-1", customerId: "cust-1" });

  return {
    memoryService,
    sessionIndex,
  } satisfies McpRuntime;
}

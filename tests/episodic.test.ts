import { describe, expect, it } from "vitest";

import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("episodic", () => {
  it("writes exactly one row with a non-null embedding of dim 1024", async () => {
    const qwen = new FakeQwenClient();
    qwen.setEmbedding("Need help with billing", 3);
    const service = new MemoryService(new InMemoryMemoryStore(), qwen);

    await service.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });
    await service.appendTurn({
      accountId: "acct-1",
      customerId: "cust-1",
      sessionId: "sess-1",
      role: "customer",
      message: "Need help with billing",
      ts: new Date("2026-06-25T10:00:00.000Z"),
    });

    expect(service.store.episodicEvents).toHaveLength(1);
    expect(service.store.episodicEvents[0]?.embedding).toHaveLength(1024);
  });
});

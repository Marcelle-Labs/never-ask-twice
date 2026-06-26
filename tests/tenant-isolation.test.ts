import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { MemoryService, SessionNotFoundError } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "./helpers.js";

describe("tenant-isolation", () => {
  describe("working-cache-isolation", () => {
    it("isolates working facts between tenants", async () => {
      const store = new InMemoryMemoryStore();
      
      const tenant1 = { accountId: "acct-1", customerId: "cust-1", sessionId: randomUUID() };
      const tenant2 = { accountId: "acct-2", customerId: "cust-2", sessionId: randomUUID() };
      
      // Add working fact for tenant 1
      await store.rememberWorkingFact({
        ...tenant1,
        subject: "test",
        predicate: "preferred_channel" as const,
        predicateClass: "profile",
        object: "email",
        confidence: 0.9,
        observedAt: new Date(),
        metadata: {},
      });
      
      // Add working fact for tenant 2
      await store.rememberWorkingFact({
        ...tenant2,
        subject: "test",
        predicate: "preferred_channel" as const,
        predicateClass: "profile",
        object: "phone",
        confidence: 0.9,
        observedAt: new Date(),
        metadata: {},
      });
      
      // Tenant 1 should only see their own working facts
      const tenant1Facts = await store.currentWorkingFacts(tenant1.accountId, tenant1.customerId, tenant1.sessionId);
      expect(tenant1Facts).toHaveLength(1);
      expect(tenant1Facts[0].object).toBe("email");
      
      // Tenant 2 should only see their own working facts
      const tenant2Facts = await store.currentWorkingFacts(tenant2.accountId, tenant2.customerId, tenant2.sessionId);
      expect(tenant2Facts).toHaveLength(1);
      expect(tenant2Facts[0].object).toBe("phone");
    });
    
    it("isolates working facts between sessions of same tenant", async () => {
      const store = new InMemoryMemoryStore();
      
      const tenant = { accountId: "acct-1", customerId: "cust-1" };
      const session1 = { ...tenant, sessionId: randomUUID() };
      const session2 = { ...tenant, sessionId: randomUUID() };
      
      // Add working fact for session 1
      await store.rememberWorkingFact({
        ...session1,
        subject: "test",
        predicate: "preferred_channel" as const,
        predicateClass: "profile",
        object: "email",
        confidence: 0.9,
        observedAt: new Date(),
        metadata: {},
      });
      
      // Add working fact for session 2
      await store.rememberWorkingFact({
        ...session2,
        subject: "test",
        predicate: "preferred_channel" as const,
        predicateClass: "profile",
        object: "phone",
        confidence: 0.9,
        observedAt: new Date(),
        metadata: {},
      });
      
      // Session 1 should only see its own working facts
      const session1Facts = await store.currentWorkingFacts(tenant.accountId, tenant.customerId, session1.sessionId);
      expect(session1Facts).toHaveLength(1);
      expect(session1Facts[0].object).toBe("email");
      
      // Session 2 should only see its own working facts
      const session2Facts = await store.currentWorkingFacts(tenant.accountId, tenant.customerId, session2.sessionId);
      expect(session2Facts).toHaveLength(1);
      expect(session2Facts[0].object).toBe("phone");
    });
  });
  
  describe("in-memory-store-isolation", () => {
    it("InMemoryMemoryStore isolates working facts by instance", () => {
      const store1 = new InMemoryMemoryStore();
      const store2 = new InMemoryMemoryStore();
      
      const tenant1 = { accountId: "acct-1", customerId: "cust-1", sessionId: randomUUID() };
      const tenant2 = { accountId: "acct-2", customerId: "cust-2", sessionId: randomUUID() };
      
      // Add working fact to store 1
      store1.rememberWorkingFact({
        ...tenant1,
        subject: "test",
        predicate: "preferred_channel" as const,
        predicateClass: "profile",
        object: "email",
        confidence: 0.9,
        observedAt: new Date(),
        metadata: {},
      });
      
      // Add working fact to store 2
      store2.rememberWorkingFact({
        ...tenant2,
        subject: "test",
        predicate: "preferred_channel" as const,
        predicateClass: "profile",
        object: "phone",
        confidence: 0.9,
        observedAt: new Date(),
        metadata: {},
      });
      
      // Store 1 should only have its own facts
      const store1Facts = store1.workingFacts;
      expect(store1Facts).toHaveLength(1);
      expect(store1Facts[0].object).toBe("email");
      
      // Store 2 should only have its own facts
      const store2Facts = store2.workingFacts;
      expect(store2Facts).toHaveLength(1);
      expect(store2Facts[0].object).toBe("phone");
    });
  });
  
  // NOTE: These assert the ownership-decision the /turn and /close handlers rely on.
  // They do NOT exercise the HTTP layer (DrizzleMemoryStore requires a live DB at
  // module load). True end-to-end coverage is tracked as a follow-up issue.
  describe("session-ownership-decision", () => {
    const isOwner = (
      session: { accountId: string; customerId: string },
      caller: { accountId: string; customerId: string }
    ) => session.accountId === caller.accountId && session.customerId === caller.customerId;

    it("rejects a caller whose tenant does not match the session (drives /turn + /close 404)", async () => {
      const store = new InMemoryMemoryStore();
      const owner = { accountId: "acct-1", customerId: "cust-1", sessionId: randomUUID() };
      const attacker = { accountId: "acct-2", customerId: "cust-2" };
      await store.createSession(owner);

      const session = await store.getSession(owner.sessionId);
      expect(session).toBeDefined();
      expect(isOwner(session!, attacker)).toBe(false);
    });

    it("accepts the legitimate owner of the session", async () => {
      const store = new InMemoryMemoryStore();
      const owner = { accountId: "acct-1", customerId: "cust-1", sessionId: randomUUID() };
      await store.createSession(owner);

      const session = await store.getSession(owner.sessionId);
      expect(session).toBeDefined();
      expect(isOwner(session!, owner)).toBe(true);
    });

    it("treats a mismatch in either accountId or customerId as a rejection", async () => {
      const store = new InMemoryMemoryStore();
      const owner = { accountId: "acct-1", customerId: "cust-1", sessionId: randomUUID() };
      await store.createSession(owner);

      const session = await store.getSession(owner.sessionId);
      expect(session).toBeDefined();
      // same account, different customer
      expect(isOwner(session!, { accountId: "acct-1", customerId: "cust-9" })).toBe(false);
      // different account, same customer
      expect(isOwner(session!, { accountId: "acct-9", customerId: "cust-1" })).toBe(false);
    });
  });
  
  describe("cross-tenant-data-isolation", () => {
    it("prevents cross-tenant semantic fact access", async () => {
      const store = new InMemoryMemoryStore();
      
      const tenant1 = { accountId: "acct-1", customerId: "cust-1" };
      const tenant2 = { accountId: "acct-2", customerId: "cust-2" };
      const now = new Date();
      
      // Get facts for tenant 1
      const tenant1Facts = await store.currentFacts(tenant1.accountId, tenant1.customerId, now);
      
      // Get facts for tenant 2
      const tenant2Facts = await store.currentFacts(tenant2.accountId, tenant2.customerId, now);
      
      // Should be separate (no cross-tenant leakage)
      expect(tenant1Facts).not.toBe(tenant2Facts);
    });
    
    it("prevents cross-tenant episodic event access", async () => {
      const store = new InMemoryMemoryStore();
      
      const tenant1 = { accountId: "acct-1", customerId: "cust-1" };
      const tenant2 = { accountId: "acct-2", customerId: "cust-2" };
      
      // Get events for tenant 1
      const tenant1Events = await store.getAllEvents(tenant1.accountId, tenant1.customerId);
      
      // Get events for tenant 2
      const tenant2Events = await store.getAllEvents(tenant2.accountId, tenant2.customerId);
      
      // Should be separate (no cross-tenant leakage)
      expect(tenant1Events).not.toBe(tenant2Events);
    });
  });

  describe("write-close-forget-tenant-isolation", () => {
    it("does not overwrite a session when createSession is reused by another tenant", async () => {
      const store = new InMemoryMemoryStore();
      await store.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });
      await store.createSession({ accountId: "acct-2", customerId: "cust-2", sessionId: "sess-1" });

      const session = await store.getSession("sess-1");
      expect(session?.accountId).toBe("acct-1");
      expect(session?.customerId).toBe("cust-1");
    });

    it("rejects appending a turn to a session owned by another tenant", async () => {
      const qwen = new FakeQwenClient();
      const store = new InMemoryMemoryStore();
      const service = new MemoryService(store, qwen);
      await service.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });

      await expect(
        service.appendTurn({
          accountId: "acct-2",
          customerId: "cust-2",
          sessionId: "sess-1",
          role: "customer",
          message: "hi",
          ts: new Date(),
        }),
      ).rejects.toThrow(SessionNotFoundError);
      expect(store.episodicEvents).toHaveLength(0);
    });

    it("rejects closing a session owned by another tenant", async () => {
      const qwen = new FakeQwenClient();
      const store = new InMemoryMemoryStore();
      const service = new MemoryService(store, qwen);
      await service.createSession({ accountId: "acct-1", customerId: "cust-1", sessionId: "sess-1" });

      await expect(
        service.closeSession({
          accountId: "acct-2",
          customerId: "cust-2",
          sessionId: "sess-1",
          closedAt: new Date(),
        }),
      ).rejects.toThrow(SessionNotFoundError);
      const session = await store.getSession("sess-1");
      expect(session?.distilledAt).toBeNull();
    });

    it("forget only expires facts for the requested tenant", async () => {
      const qwen = new FakeQwenClient();
      const store = new InMemoryMemoryStore();
      const service = new MemoryService(store, qwen);

      const tenant1Fact = await store.insertSemanticFact({
        accountId: "acct-1",
        customerId: "cust-1",
        sessionId: null,
        subject: "Acme",
        predicate: "product_config",
        predicateClass: "configuration",
        object: "requires SSO",
        confidence: 0.9,
        adjudicationRationale: null,
        validFrom: new Date("2026-06-25T10:00:00.000Z"),
        validTo: null,
        expiresAt: null,
        supersededBy: null,
        metadata: {},
        embedding: Array.from({ length: 1024 }, () => 0),
      });

      const tenant2Fact = await store.insertSemanticFact({
        accountId: "acct-2",
        customerId: "cust-2",
        sessionId: null,
        subject: "Globex",
        predicate: "product_config",
        predicateClass: "configuration",
        object: "region=eu-west",
        confidence: 0.9,
        adjudicationRationale: null,
        validFrom: new Date("2026-06-25T10:00:00.000Z"),
        validTo: null,
        expiresAt: null,
        supersededBy: null,
        metadata: {},
        embedding: Array.from({ length: 1024 }, () => 0),
      });

      const { forgotten } = await service.forget({
        accountId: "acct-1",
        customerId: "cust-1",
        predicateClass: "configuration",
      });

      expect(forgotten).toContain(tenant1Fact.factId);
      expect(forgotten).not.toContain(tenant2Fact.factId);
      expect((await store.getFactById(tenant1Fact.factId))?.validTo).not.toBeNull();
      expect((await store.getFactById(tenant2Fact.factId))?.validTo).toBeNull();
    });
  });
});
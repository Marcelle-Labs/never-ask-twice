import { randomUUID } from "node:crypto";

import type {
  EpisodicEventRecord,
  EscalationContactCorrection,
  EscalationContactCorrectionResult,
  MemoryStore,
  SemanticFactProvenanceRecord,
  SemanticFactRecord,
  SessionRecord,
  WorkingMemoryRecord,
} from "./types.js";

export class InMemoryMemoryStore implements MemoryStore {
  readonly sessions = new Map<string, SessionRecord>();
  readonly episodicEvents: EpisodicEventRecord[] = [];
  readonly semanticFacts: SemanticFactRecord[] = [];
  readonly semanticFactProvenance: SemanticFactProvenanceRecord[] = [];
  readonly workingFacts: WorkingMemoryRecord[] = [];

  async createSession(record: { sessionId: string; accountId: string; customerId: string }) {
    const existing = this.sessions.get(record.sessionId);
    if (existing) {
      return existing;
    }
    const session: SessionRecord = {
      ...record,
      openedAt: new Date(),
      closedAt: null,
      distilledAt: null,
      distillationStatus: "open",
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  async getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  async updateSession(sessionId: string, updates: Partial<SessionRecord>) {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates);
    }
  }

  async appendEvent(record: Omit<EpisodicEventRecord, "eventId">) {
    const event = { ...record, eventId: randomUUID() };
    this.episodicEvents.push(event);
    return event;
  }

  async getEvents(sessionId: string) {
    return this.episodicEvents.filter((e) => e.sessionId === sessionId);
  }

  async getAllEvents(accountId: string, customerId: string) {
    return this.episodicEvents.filter(
      (e) => e.accountId === accountId && e.customerId === customerId
    );
  }

  async rememberWorkingFact(record: WorkingMemoryRecord) {
    this.workingFacts.push(record);
    return record;
  }

  async clearWorkingFacts(sessionId: string) {
    for (let i = this.workingFacts.length - 1; i >= 0; i--) {
      if (this.workingFacts[i]!.sessionId === sessionId) {
        this.workingFacts.splice(i, 1);
      }
    }
  }

  async currentFacts(accountId: string, customerId: string, now: Date) {
    return this.semanticFacts.filter(
      (fact) =>
        fact.accountId === accountId &&
        fact.customerId === customerId &&
        fact.validTo === null &&
        (fact.expiresAt === null || fact.expiresAt > now)
    );
  }

  async unsupersededFacts(accountId: string, customerId: string) {
    return this.semanticFacts.filter(
      (fact) =>
        fact.accountId === accountId &&
        fact.customerId === customerId &&
        fact.validTo === null
    );
  }

  async getSemanticFactsBySession(sessionId: string) {
    return this.semanticFacts.filter((f) => f.sessionId === sessionId);
  }

  async getFactById(factId: string) {
    return this.semanticFacts.find((f) => f.factId === factId);
  }

  async getFactsByPredicateClass(predicateClass: string) {
    return this.semanticFacts.filter((f) => f.predicateClass === predicateClass);
  }

  async currentWorkingFacts(accountId: string, customerId: string, sessionId?: string) {
    return this.workingFacts.filter(
      (fact) =>
        fact.accountId === accountId &&
        fact.customerId === customerId &&
        (sessionId === undefined || fact.sessionId === sessionId)
    );
  }

  async insertSemanticFact(record: Omit<SemanticFactRecord, "factId"> & { factId?: string }) {
    const fact = { ...record, factId: record.factId ?? randomUUID() };
    this.semanticFacts.push(fact);
    return fact;
  }

  async upsertSeedFact(record: Omit<SemanticFactRecord, "factId"> & { factId?: string }) {
    const fact = { ...record, factId: record.factId ?? randomUUID() };
    const existingIdx = this.semanticFacts.findIndex(
      (f) =>
        f.accountId === record.accountId &&
        f.customerId === record.customerId &&
        f.predicate === record.predicate &&
        f.validTo === null
    );
    if (existingIdx >= 0) {
      return this.semanticFacts[existingIdx]!;
    }
    this.semanticFacts.push(fact);
    return fact;
  }

  async updateSemanticFact(factId: string, updates: Partial<SemanticFactRecord>) {
    const fact = this.semanticFacts.find((f) => f.factId === factId);
    if (fact) {
      Object.assign(fact, updates);
    }
  }

  async addProvenance(record: SemanticFactProvenanceRecord) {
    const exists = this.semanticFactProvenance.some(
      (item) => item.factId === record.factId && item.eventId === record.eventId
    );
    if (!exists) {
      this.semanticFactProvenance.push(record);
    }
  }

  async correctEscalationContact(
    correction: EscalationContactCorrection,
  ): Promise<EscalationContactCorrectionResult> {
    const current = this.semanticFacts.filter((fact) =>
      fact.accountId === correction.accountId &&
      fact.customerId === correction.customerId &&
      fact.predicate === "escalation_contact" &&
      fact.validTo === null,
    );
    if (current.length !== 1) throw new Error("Expected one current escalation contact.");
    const old = current[0]!;
    if (old.object === correction.newContact) {
      return { previousContact: old.object, currentContact: old.object, changed: false };
    }

    // Snapshot all touched collections. The production implementation uses a
    // database transaction; this gives the test store the equivalent all-or-
    // nothing behavior and makes stage-failure tests meaningful.
    const factsSnapshot = this.semanticFacts.map((fact) => ({ ...fact, metadata: { ...fact.metadata } }));
    const eventsSnapshot = [...this.episodicEvents];
    const provenanceSnapshot = [...this.semanticFactProvenance];
    const sessionsSnapshot = new Map(this.sessions);
    try {
      const replacementId = randomUUID();
      const sessionId = `webmcp:${correction.actionId}`;
      await this.createSession({ sessionId, accountId: correction.accountId, customerId: correction.customerId });
      const event = await this.appendEvent({
        accountId: correction.accountId, customerId: correction.customerId, sessionId,
        role: "agent", message: "Confirmed escalation-contact correction.", ts: correction.now,
        embedding: [], metadata: { source: "confirmed-webmcp-action", actionId: correction.actionId },
      });
      old.validTo = correction.now;
      old.supersededBy = replacementId;
      const replacement: SemanticFactRecord = {
        ...old, factId: replacementId, sessionId, object: correction.newContact,
        validFrom: correction.now, validTo: null, supersededBy: null,
        metadata: { source: "confirmed-webmcp-action", actionId: correction.actionId, reason: correction.reason },
      };
      await this.insertSemanticFact(replacement);
      await this.addProvenance({ factId: replacementId, eventId: event.eventId, weight: 1, rationale: "Confirmed WebMCP escalation-contact correction." });
      return { previousContact: old.object, currentContact: replacement.object, changed: true };
    } catch (error) {
      this.semanticFacts.splice(0, this.semanticFacts.length, ...factsSnapshot);
      this.episodicEvents.splice(0, this.episodicEvents.length, ...eventsSnapshot);
      this.semanticFactProvenance.splice(0, this.semanticFactProvenance.length, ...provenanceSnapshot);
      this.sessions.clear();
      for (const [key, value] of sessionsSnapshot) this.sessions.set(key, value);
      throw error;
    }
  }
}

import { randomUUID } from "node:crypto";

import type {
  EpisodicEventRecord,
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
}

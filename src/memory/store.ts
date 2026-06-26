import { randomUUID } from "node:crypto";

import type {
  EpisodicEventRecord,
  SemanticFactProvenanceRecord,
  SemanticFactRecord,
  SessionRecord,
  WorkingMemoryRecord,
} from "./types.js";

export class InMemoryMemoryStore {
  readonly sessions = new Map<string, SessionRecord>();
  readonly episodicEvents: EpisodicEventRecord[] = [];
  readonly semanticFacts: SemanticFactRecord[] = [];
  readonly semanticFactProvenance: SemanticFactProvenanceRecord[] = [];
  readonly workingFacts: WorkingMemoryRecord[] = [];

  createSession(record: Omit<SessionRecord, "openedAt" | "closedAt" | "distilledAt" | "distillationStatus">) {
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

  appendEvent(record: Omit<EpisodicEventRecord, "eventId">) {
    const event = { ...record, eventId: randomUUID() };
    this.episodicEvents.push(event);
    return event;
  }

  rememberWorkingFact(record: WorkingMemoryRecord) {
    this.workingFacts.push(record);
    return record;
  }

  currentFacts(accountId: string, customerId: string, now: Date) {
    return this.semanticFacts.filter(
      (fact) =>
        fact.accountId === accountId &&
        fact.customerId === customerId &&
        fact.validTo === null &&
        (fact.expiresAt === null || fact.expiresAt > now),
    );
  }

  currentWorkingFacts(accountId: string, customerId: string, sessionId?: string) {
    return this.workingFacts.filter(
      (fact) =>
        fact.accountId === accountId &&
        fact.customerId === customerId &&
        (sessionId === undefined || fact.sessionId === sessionId),
    );
  }

  insertSemanticFact(record: Omit<SemanticFactRecord, "factId">) {
    const fact = { ...record, factId: randomUUID() };
    this.semanticFacts.push(fact);
    return fact;
  }

  addProvenance(record: SemanticFactProvenanceRecord) {
    const exists = this.semanticFactProvenance.some(
      (item) => item.factId === record.factId && item.eventId === record.eventId,
    );
    if (!exists) {
      this.semanticFactProvenance.push(record);
    }
  }
}

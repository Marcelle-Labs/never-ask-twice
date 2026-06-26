import { randomUUID } from "node:crypto";

import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../../../src/db/schema.js";
import type {
  EpisodicEventRecord,
  MemoryStore,
  SemanticFactProvenanceRecord,
  SemanticFactRecord,
  SessionRecord,
  WorkingMemoryRecord,
} from "../../../src/memory/types.js";

type Db = NodePgDatabase<typeof schema>;

export class DrizzleMemoryStore implements MemoryStore {
  // In-memory working-facts store (working facts are ephemeral to the session)
  private workingFactsCache: WorkingMemoryRecord[] = [];

  constructor(private readonly db: Db) {}

  async createSession(
    record: Pick<SessionRecord, "sessionId" | "accountId" | "customerId">
  ): Promise<SessionRecord> {
    const row = await this.db
      .insert(schema.sessions)
      .values({
        sessionId: record.sessionId,
        accountId: record.accountId,
        customerId: record.customerId,
      })
      .onConflictDoNothing()
      .returning();

    const inserted = row[0];
    if (!inserted) {
      // Already exists — fetch it
      const existing = await this.db
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.sessionId, record.sessionId));
      const s = existing[0]!;
      return {
        sessionId: s.sessionId,
        accountId: s.accountId,
        customerId: s.customerId,
        openedAt: s.openedAt,
        closedAt: s.closedAt ?? null,
        distilledAt: s.distilledAt ?? null,
        distillationStatus: (s.distillationStatus as "open" | "complete") ?? "open",
      };
    }

    return {
      sessionId: inserted.sessionId,
      accountId: inserted.accountId,
      customerId: inserted.customerId,
      openedAt: inserted.openedAt,
      closedAt: inserted.closedAt ?? null,
      distilledAt: inserted.distilledAt ?? null,
      distillationStatus: (inserted.distillationStatus as "open" | "complete") ?? "open",
    };
  }

  async getSession(sessionId: string): Promise<SessionRecord | undefined> {
    const rows = await this.db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.sessionId, sessionId));
    const s = rows[0];
    if (!s) return undefined;
    return {
      sessionId: s.sessionId,
      accountId: s.accountId,
      customerId: s.customerId,
      openedAt: s.openedAt,
      closedAt: s.closedAt ?? null,
      distilledAt: s.distilledAt ?? null,
      distillationStatus: (s.distillationStatus as "open" | "complete") ?? "open",
    };
  }

  async updateSession(sessionId: string, updates: Partial<SessionRecord>): Promise<void> {
    await this.db
      .update(schema.sessions)
      .set(updates)
      .where(eq(schema.sessions.sessionId, sessionId));
  }

  async appendEvent(record: Omit<EpisodicEventRecord, "eventId">): Promise<EpisodicEventRecord> {
    const eventId = randomUUID();
    await this.db.insert(schema.episodicEvents).values({
      eventId,
      accountId: record.accountId,
      customerId: record.customerId,
      sessionId: record.sessionId,
      role: record.role,
      message: record.message,
      ts: record.ts,
      embedding: record.embedding,
      metadata: record.metadata,
    });
    return { ...record, eventId };
  }

  async getEvents(sessionId: string): Promise<EpisodicEventRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.episodicEvents)
      .where(eq(schema.episodicEvents.sessionId, sessionId));
    return rows.map((r) => ({
      eventId: r.eventId,
      accountId: r.accountId,
      customerId: r.customerId,
      sessionId: r.sessionId,
      role: r.role as "customer" | "agent",
      message: r.message,
      ts: r.ts,
      embedding: r.embedding as number[],
      metadata: r.metadata as Record<string, unknown>,
    }));
  }

  async getAllEvents(accountId: string, customerId: string): Promise<EpisodicEventRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.episodicEvents)
      .where(
        and(eq(schema.episodicEvents.accountId, accountId), eq(schema.episodicEvents.customerId, customerId))
      );
    return rows.map((r) => ({
      eventId: r.eventId,
      accountId: r.accountId,
      customerId: r.customerId,
      sessionId: r.sessionId,
      role: r.role as "customer" | "agent",
      message: r.message,
      ts: r.ts,
      embedding: r.embedding as number[],
      metadata: r.metadata as Record<string, unknown>,
    }));
  }

  async rememberWorkingFact(record: WorkingMemoryRecord): Promise<WorkingMemoryRecord> {
    this.workingFactsCache.push(record);
    return record;
  }

  async currentWorkingFacts(
    accountId: string,
    customerId: string,
    sessionId?: string
  ): Promise<WorkingMemoryRecord[]> {
    return this.workingFactsCache.filter(
      (f) =>
        f.accountId === accountId &&
        f.customerId === customerId &&
        (sessionId === undefined || f.sessionId === sessionId)
    );
  }

  async currentFacts(accountId: string, customerId: string, now: Date): Promise<SemanticFactRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.semanticFacts)
      .where(
        and(
          eq(schema.semanticFacts.accountId, accountId),
          eq(schema.semanticFacts.customerId, customerId),
          isNull(schema.semanticFacts.validTo),
          or(isNull(schema.semanticFacts.expiresAt), sql`${schema.semanticFacts.expiresAt} > ${now}`)
        )
      );

    return rows.map((r) => ({
      factId: r.factId,
      accountId: r.accountId,
      customerId: r.customerId,
      sessionId: r.sessionId ?? null,
      subject: r.subject,
      predicate: r.predicate as SemanticFactRecord["predicate"],
      predicateClass: r.predicateClass,
      object: r.object,
      confidence: r.confidence,
      adjudicationRationale: r.adjudicationRationale ?? null,
      validFrom: r.validFrom,
      validTo: r.validTo ?? null,
      expiresAt: r.expiresAt ?? null,
      supersededBy: r.supersededBy ?? null,
      metadata: r.metadata as Record<string, unknown>,
      embedding: r.embedding as number[],
    }));
  }

  async getSemanticFactsBySession(sessionId: string): Promise<SemanticFactRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.semanticFacts)
      .where(eq(schema.semanticFacts.sessionId, sessionId));
    return rows.map((r) => ({
      factId: r.factId,
      accountId: r.accountId,
      customerId: r.customerId,
      sessionId: r.sessionId ?? null,
      subject: r.subject,
      predicate: r.predicate as SemanticFactRecord["predicate"],
      predicateClass: r.predicateClass,
      object: r.object,
      confidence: r.confidence,
      adjudicationRationale: r.adjudicationRationale ?? null,
      validFrom: r.validFrom,
      validTo: r.validTo ?? null,
      expiresAt: r.expiresAt ?? null,
      supersededBy: r.supersededBy ?? null,
      metadata: r.metadata as Record<string, unknown>,
      embedding: r.embedding as number[],
    }));
  }

  async getFactById(factId: string): Promise<SemanticFactRecord | undefined> {
    const rows = await this.db
      .select()
      .from(schema.semanticFacts)
      .where(eq(schema.semanticFacts.factId, factId));
    const r = rows[0];
    if (!r) return undefined;
    return {
      factId: r.factId,
      accountId: r.accountId,
      customerId: r.customerId,
      sessionId: r.sessionId ?? null,
      subject: r.subject,
      predicate: r.predicate as SemanticFactRecord["predicate"],
      predicateClass: r.predicateClass,
      object: r.object,
      confidence: r.confidence,
      adjudicationRationale: r.adjudicationRationale ?? null,
      validFrom: r.validFrom,
      validTo: r.validTo ?? null,
      expiresAt: r.expiresAt ?? null,
      supersededBy: r.supersededBy ?? null,
      metadata: r.metadata as Record<string, unknown>,
      embedding: r.embedding as number[],
    };
  }

  async getFactsByPredicateClass(predicateClass: string): Promise<SemanticFactRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.semanticFacts)
      .where(eq(schema.semanticFacts.predicateClass, predicateClass));
    return rows.map((r) => ({
      factId: r.factId,
      accountId: r.accountId,
      customerId: r.customerId,
      sessionId: r.sessionId ?? null,
      subject: r.subject,
      predicate: r.predicate as SemanticFactRecord["predicate"],
      predicateClass: r.predicateClass,
      object: r.object,
      confidence: r.confidence,
      adjudicationRationale: r.adjudicationRationale ?? null,
      validFrom: r.validFrom,
      validTo: r.validTo ?? null,
      expiresAt: r.expiresAt ?? null,
      supersededBy: r.supersededBy ?? null,
      metadata: r.metadata as Record<string, unknown>,
      embedding: r.embedding as number[],
    }));
  }

  async insertSemanticFact(record: Omit<SemanticFactRecord, "factId">): Promise<SemanticFactRecord> {
    const factId = randomUUID();
    await this.db.insert(schema.semanticFacts).values({
      factId,
      accountId: record.accountId,
      customerId: record.customerId,
      sessionId: record.sessionId ?? undefined,
      subject: record.subject,
      predicate: record.predicate,
      predicateClass: record.predicateClass,
      object: record.object,
      confidence: record.confidence,
      adjudicationRationale: record.adjudicationRationale ?? undefined,
      validFrom: record.validFrom,
      validTo: record.validTo ?? undefined,
      expiresAt: record.expiresAt ?? undefined,
      supersededBy: record.supersededBy ?? undefined,
      metadata: record.metadata,
      embedding: record.embedding,
    });
    return { ...record, factId };
  }

  async updateSemanticFact(factId: string, updates: Partial<SemanticFactRecord>): Promise<void> {
    await this.db
      .update(schema.semanticFacts)
      .set(updates)
      .where(eq(schema.semanticFacts.factId, factId));
  }

  async addProvenance(record: SemanticFactProvenanceRecord): Promise<void> {
    await this.db
      .insert(schema.semanticFactProvenance)
      .values({
        factId: record.factId,
        eventId: record.eventId,
        weight: record.weight,
        rationale: record.rationale ?? undefined,
      })
      .onConflictDoNothing();
  }
}

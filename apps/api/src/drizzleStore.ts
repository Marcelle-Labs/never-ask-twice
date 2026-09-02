import { randomUUID } from "node:crypto";

import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../../../src/db/schema.js";
import type {
  EpisodicEventRecord,
  EscalationContactCorrection,
  EscalationContactCorrectionResult,
  MemoryStore,
  SemanticFactProvenanceRecord,
  SemanticFactRecord,
  SessionRecord,
  WorkingMemoryRecord,
} from "../../../src/memory/types.js";

type Db = NodePgDatabase<typeof schema>;

const MAX_CACHE_SESSIONS = 500;

export class DrizzleMemoryStore implements MemoryStore {
  // In-memory working-facts store keyed by sessionId for O(1) eviction.
  // Bounded by MAX_CACHE_SESSIONS with FIFO overflow eviction.
  private readonly workingFactsCache = new Map<string, WorkingMemoryRecord[]>();

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
      .where(eq(schema.episodicEvents.sessionId, sessionId))
      .orderBy(asc(schema.episodicEvents.ts));
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
      )
      .orderBy(asc(schema.episodicEvents.ts));
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
    const list = this.workingFactsCache.get(record.sessionId);
    if (list) {
      list.push(record);
    } else {
      this.workingFactsCache.set(record.sessionId, [record]);
      // Enforce bound: evict oldest session entry if over limit.
      // Skip sessions that are still open (live) — only evict closed/unknown ones.
      if (this.workingFactsCache.size > MAX_CACHE_SESSIONS) {
        await this.evictStaleSession();
      }
    }
    return record;
  }

  private async evictStaleSession(): Promise<void> {
    for (const key of this.workingFactsCache.keys()) {
      const rows = await this.db
        .select({ closedAt: schema.sessions.closedAt, status: schema.sessions.distillationStatus })
        .from(schema.sessions)
        .where(eq(schema.sessions.sessionId, key))
        .limit(1);
      const row = rows[0];
      // Evict if session is closed, distilled, or not found in DB (stale)
      if (!row || row.closedAt !== null || row.status === "complete") {
        this.workingFactsCache.delete(key);
        return;
      }
    }
  }

  async currentWorkingFacts(
    accountId: string,
    customerId: string,
    sessionId?: string
  ): Promise<WorkingMemoryRecord[]> {
    if (sessionId !== undefined) {
      const list = this.workingFactsCache.get(sessionId);
      if (!list) return [];
      return list.filter(
        (f) => f.accountId === accountId && f.customerId === customerId
      );
    }
    // No sessionId filter — scan all cached sessions
    const result: WorkingMemoryRecord[] = [];
    for (const list of this.workingFactsCache.values()) {
      result.push(...list.filter(
        (f) => f.accountId === accountId && f.customerId === customerId
      ));
    }
    return result;
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

  async unsupersededFacts(accountId: string, customerId: string): Promise<SemanticFactRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.semanticFacts)
      .where(
        and(
          eq(schema.semanticFacts.accountId, accountId),
          eq(schema.semanticFacts.customerId, customerId),
          isNull(schema.semanticFacts.validTo)
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

  async insertSemanticFact(record: Omit<SemanticFactRecord, "factId"> & { factId?: string }): Promise<SemanticFactRecord> {
    const factId = record.factId ?? randomUUID();
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

  async upsertSeedFact(record: Omit<SemanticFactRecord, "factId"> & { factId?: string }): Promise<SemanticFactRecord> {
    const factId = record.factId ?? randomUUID();
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
    }).onConflictDoNothing();
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

  async correctEscalationContact(
    correction: EscalationContactCorrection,
  ): Promise<EscalationContactCorrectionResult> {
    return this.db.transaction(async (tx) => {
      // Lock the current row before inspecting it. The partial unique index is
      // the final database invariant; this lock also gives concurrent confirmed
      // requests a serial current-value transition instead of a racy read.
      await tx.execute(sql`
        SELECT fact_id FROM semantic_facts
        WHERE account_id = ${correction.accountId}
          AND customer_id = ${correction.customerId}
          AND predicate = 'escalation_contact'
          AND valid_to IS NULL
        FOR UPDATE
      `);
      const current = await tx
        .select()
        .from(schema.semanticFacts)
        .where(and(
          eq(schema.semanticFacts.accountId, correction.accountId),
          eq(schema.semanticFacts.customerId, correction.customerId),
          eq(schema.semanticFacts.predicate, "escalation_contact"),
          isNull(schema.semanticFacts.validTo),
        ));
      if (current.length !== 1) throw new Error("Expected one current escalation contact.");
      const old = current[0]!;
      if (old.object === correction.newContact) {
        return { previousContact: old.object, currentContact: old.object, changed: false };
      }

      const replacementId = randomUUID();
      const sessionId = `webmcp:${correction.actionId}`;
      const eventId = randomUUID();
      // The FK on superseded_by means the old row cannot point at the new row
      // before it exists. Close it first (inside this transaction), insert the
      // replacement, then link the history. A failure at any stage rolls the
      // whole transaction back, including the temporary close.
      await tx.insert(schema.sessions).values({
        sessionId, accountId: correction.accountId, customerId: correction.customerId,
      });
      await tx.insert(schema.episodicEvents).values({
        eventId, accountId: correction.accountId, customerId: correction.customerId,
        sessionId, role: "agent", message: "Confirmed escalation-contact correction.",
        ts: correction.now, embedding: new Array(1024).fill(0),
        metadata: { source: "confirmed-webmcp-action", actionId: correction.actionId },
      });
      await tx.update(schema.semanticFacts).set({ validTo: correction.now })
        .where(eq(schema.semanticFacts.factId, old.factId));
      await tx.insert(schema.semanticFacts).values({
        factId: replacementId, accountId: old.accountId, customerId: old.customerId,
        sessionId, subject: old.subject, predicate: old.predicate,
        predicateClass: old.predicateClass, object: correction.newContact,
        confidence: old.confidence, adjudicationRationale: old.adjudicationRationale ?? undefined,
        validFrom: correction.now, metadata: {
          source: "confirmed-webmcp-action", actionId: correction.actionId, reason: correction.reason,
        }, embedding: old.embedding as number[],
      });
      await tx.update(schema.semanticFacts).set({ supersededBy: replacementId })
        .where(eq(schema.semanticFacts.factId, old.factId));
      await tx.insert(schema.semanticFactProvenance).values({
        factId: replacementId, eventId, weight: 1,
        rationale: "Confirmed WebMCP escalation-contact correction.",
      });
      return { previousContact: old.object, currentContact: correction.newContact, changed: true };
    });
  }

  async clearWorkingFacts(sessionId: string): Promise<void> {
    this.workingFactsCache.delete(sessionId);
  }
}

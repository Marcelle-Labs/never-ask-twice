import { randomUUID } from "node:crypto";

import {
  DistilledFactCandidateSchema,
  RecallInputSchema,
  TurnInputSchema,
  type DistilledFactCandidate,
  type RecallInput,
  type TurnInput,
} from "../contracts.js";
import type { QwenClient } from "../qwen/qwenClient.js";
import type { MemoryStore, SemanticFactRecord } from "./types.js";

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function approxTokens(input: string) {
  return Math.ceil(input.length / 4);
}

function predicateRelevanceBoost(predicate: string, query: string) {
  const normalizedQuery = query.toLowerCase();
  if (normalizedQuery.includes("billing") && predicate === "sla_tier") {
    return 1;
  }
  if (normalizedQuery.includes("integration") && predicate === "integration") {
    return 1;
  }
  if (normalizedQuery.includes("timezone") && predicate === "timezone") {
    return 1;
  }
  return 0.2;
}

function recencyScore(date: Date, now: Date) {
  const ageHours = Math.max((now.getTime() - date.getTime()) / 3_600_000, 0);
  return 1 / (1 + ageHours);
}

export class MemoryService {
  constructor(
    readonly store: MemoryStore,
    readonly qwenClient: QwenClient,
  ) {}

  async createSession(input: { accountId: string; customerId: string; sessionId?: string }) {
    const sessionId = input.sessionId ?? randomUUID();
    return await this.store.createSession({
      sessionId,
      accountId: input.accountId,
      customerId: input.customerId,
    });
  }

  async appendTurn(input: TurnInput) {
    const turn = TurnInputSchema.parse(input);
    const embedding = await this.qwenClient.embed(turn.message);
    return await this.store.appendEvent({
      accountId: turn.accountId,
      customerId: turn.customerId,
      sessionId: turn.sessionId,
      role: turn.role,
      message: turn.message,
      ts: turn.ts,
      embedding,
      metadata: {},
    });
  }

  async rememberWorkingFact(input: {
    accountId: string;
    customerId: string;
    sessionId: string;
    candidate: DistilledFactCandidate;
    observedAt: Date;
  }) {
    const candidate = DistilledFactCandidateSchema.parse(input.candidate);
    return await this.store.rememberWorkingFact({
      ...candidate,
      accountId: input.accountId,
      customerId: input.customerId,
      sessionId: input.sessionId,
      observedAt: input.observedAt,
    });
  }

  async closeSession(input: {
    sessionId: string;
    accountId: string;
    customerId: string;
    closedAt: Date;
  }) {
    const session = await this.store.getSession(input.sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${input.sessionId}`);
    }

    if (session.distilledAt) {
      return {
        session,
        facts: await this.store.getSemanticFactsBySession(input.sessionId),
      };
    }

    const events = await this.store.getEvents(input.sessionId);
    const transcript = events.map((event) => `${event.role}: ${event.message}`).join("\n");
    const candidates = await this.qwenClient.distill({ transcript });
    const insertedFacts: SemanticFactRecord[] = [];

    const existingFacts = await this.store.currentFacts(input.accountId, input.customerId, input.closedAt);

    for (const candidate of candidates.map((item) => DistilledFactCandidateSchema.parse(item))) {
      const embedding = await this.qwenClient.embed(
        `${candidate.subject} ${candidate.predicate} ${candidate.object}`
      );
      const current = existingFacts.find(
        (fact) => fact.subject === candidate.subject && fact.predicate === candidate.predicate
      );

      if (current && current.object === candidate.object) {
        continue;
      }

      const expiresAt = candidate.ttlDays
        ? new Date(input.closedAt.getTime() + candidate.ttlDays * 24 * 3_600_000)
        : null;

      const newFact = await this.store.insertSemanticFact({
        accountId: input.accountId,
        customerId: input.customerId,
        sessionId: input.sessionId,
        subject: candidate.subject,
        predicate: candidate.predicate,
        predicateClass: candidate.predicateClass,
        object: candidate.object,
        confidence: candidate.confidence,
        adjudicationRationale: candidate.rationale ?? null,
        validFrom: input.closedAt,
        validTo: null,
        expiresAt,
        supersededBy: null,
        metadata: candidate.metadata,
        embedding,
      });

      if (current) {
        await this.store.updateSemanticFact(current.factId, {
          validTo: input.closedAt,
          supersededBy: newFact.factId,
        });
      }

      for (const event of events) {
        await this.store.addProvenance({
          factId: newFact.factId,
          eventId: event.eventId,
          weight: 1,
          rationale: "derived-from-session-close",
        });
      }

      insertedFacts.push(newFact);
    }

    await this.store.updateSession(input.sessionId, {
      closedAt: input.closedAt,
      distilledAt: input.closedAt,
      distillationStatus: "complete",
    });

    const finalSession = (await this.store.getSession(input.sessionId))!;
    return { session: finalSession, facts: insertedFacts };
  }

  async recall(input: RecallInput) {
    const recall = RecallInputSchema.parse(input);
    const queryEmbedding = await this.qwenClient.embed(recall.query);
    const currentFacts = await this.store.currentFacts(recall.accountId, recall.customerId, recall.now);
    const semantic = currentFacts.map((fact) => ({
      kind: "semantic" as const,
      score:
        0.45 * cosineSimilarity(queryEmbedding, fact.embedding) +
        0.25 * fact.confidence +
        0.2 * predicateRelevanceBoost(fact.predicate, recall.query) +
        0.1 * recencyScore(fact.validFrom, recall.now),
      payload: fact,
      summary: `${fact.subject} ${fact.predicate} ${fact.object}`,
    }));

    const events = await this.store.getAllEvents(recall.accountId, recall.customerId);
    const episodic = events.map((event) => ({
      kind: "episodic" as const,
      score:
        0.7 * cosineSimilarity(queryEmbedding, event.embedding) + 0.3 * recencyScore(event.ts, recall.now),
      payload: event,
      summary: `${event.role}: ${event.message}`,
    }));

    const workingFacts = await this.store.currentWorkingFacts(
      recall.accountId,
      recall.customerId,
      recall.sessionId
    );
    const working = workingFacts.map((fact) => ({
      kind: "working" as const,
      score: 1.5 + 0.2 * predicateRelevanceBoost(fact.predicate, recall.query),
      payload: fact,
      summary: `${fact.subject} ${fact.predicate} ${fact.object}`,
    }));

    const ranked = [...semantic, ...episodic, ...working].sort((left, right) => right.score - left.score);

    const kept: typeof ranked = [];
    const dropped: typeof ranked = [];
    let usedTokens = 0;

    for (const item of ranked) {
      const itemTokens = approxTokens(item.summary);
      if (usedTokens + itemTokens <= recall.tokenBudget) {
        kept.push(item);
        usedTokens += itemTokens;
      } else {
        dropped.push(item);
      }
    }

    return {
      bundle: kept,
      dropList: dropped.map((item) => item.summary),
      usedTokens,
    };
  }
}

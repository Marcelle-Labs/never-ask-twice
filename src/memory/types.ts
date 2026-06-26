import type { DistilledFactCandidate, MemoryPredicate } from "../contracts.js";

export interface SessionRecord {
  sessionId: string;
  accountId: string;
  customerId: string;
  openedAt: Date;
  closedAt: Date | null;
  distilledAt: Date | null;
  distillationStatus: "open" | "complete";
}

export interface EpisodicEventRecord {
  eventId: string;
  accountId: string;
  customerId: string;
  sessionId: string;
  role: "customer" | "agent";
  message: string;
  ts: Date;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface SemanticFactRecord {
  factId: string;
  accountId: string;
  customerId: string;
  sessionId: string | null;
  subject: string;
  predicate: MemoryPredicate;
  predicateClass: string;
  object: string;
  confidence: number;
  adjudicationRationale: string | null;
  validFrom: Date;
  validTo: Date | null;
  expiresAt: Date | null;
  supersededBy: string | null;
  metadata: Record<string, unknown>;
  embedding: number[];
}

export interface SemanticFactProvenanceRecord {
  factId: string;
  eventId: string;
  weight: number;
  rationale: string | null;
}

export interface WorkingMemoryRecord extends DistilledFactCandidate {
  sessionId: string;
  accountId: string;
  customerId: string;
  observedAt: Date;
}

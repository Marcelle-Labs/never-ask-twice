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

export interface MemoryStore {
  createSession(record: {
    sessionId: string;
    accountId: string;
    customerId: string;
  }): Promise<SessionRecord>;
  getSession(sessionId: string): Promise<SessionRecord | undefined>;
  updateSession(sessionId: string, updates: Partial<SessionRecord>): Promise<void>;

  appendEvent(record: Omit<EpisodicEventRecord, "eventId">): Promise<EpisodicEventRecord>;
  getEvents(sessionId: string): Promise<EpisodicEventRecord[]>;
  getAllEvents(accountId: string, customerId: string): Promise<EpisodicEventRecord[]>;

  rememberWorkingFact(record: WorkingMemoryRecord): Promise<WorkingMemoryRecord>;
  currentWorkingFacts(
    accountId: string,
    customerId: string,
    sessionId?: string
  ): Promise<WorkingMemoryRecord[]>;

  currentFacts(accountId: string, customerId: string, now: Date): Promise<SemanticFactRecord[]>;
  getSemanticFactsBySession(sessionId: string): Promise<SemanticFactRecord[]>;
  getFactById(factId: string): Promise<SemanticFactRecord | undefined>;
  getFactsByPredicateClass(predicateClass: string): Promise<SemanticFactRecord[]>;
  insertSemanticFact(record: Omit<SemanticFactRecord, "factId">): Promise<SemanticFactRecord>;
  updateSemanticFact(factId: string, updates: Partial<SemanticFactRecord>): Promise<void>;

  addProvenance(record: SemanticFactProvenanceRecord): Promise<void>;
}

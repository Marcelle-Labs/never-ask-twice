import { z } from "zod";

export const MEMORY_EMBEDDING_DIM = 1024;

export const memoryPredicateValues = [
  "preferred_channel",
  "sla_tier",
  "product_plan",
  "product_config",
  "integration",
  "escalation_contact",
  "open_issue",
  "promised_follow_up",
  "known_constraint",
  "timezone",
  "technical_contact",
] as const;

export const MemoryPredicateSchema = z.enum(memoryPredicateValues);
export type MemoryPredicate = z.infer<typeof MemoryPredicateSchema>;

export const PredicateClassSchema = z.enum([
  "profile",
  "contract",
  "configuration",
  "relationship",
  "constraint",
  "temporal",
  "issue",
]);

export const DistilledFactCandidateSchema = z.object({
  subject: z.string().min(1),
  predicate: MemoryPredicateSchema,
  predicateClass: PredicateClassSchema,
  object: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).optional(),
  ttlDays: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type DistilledFactCandidate = z.infer<typeof DistilledFactCandidateSchema>;

export const TurnInputSchema = z.object({
  accountId: z.string().min(1),
  customerId: z.string().min(1),
  sessionId: z.string().min(1),
  role: z.enum(["customer", "agent"]),
  message: z.string().min(1),
  ts: z.date(),
});

export type TurnInput = z.infer<typeof TurnInputSchema>;

export const RecallInputSchema = z.object({
  accountId: z.string().min(1),
  customerId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  query: z.string().min(1),
  tokenBudget: z.number().int().positive().default(1200),
  now: z.date().default(() => new Date()),
});

export type RecallInput = z.infer<typeof RecallInputSchema>;

import { z } from "zod";

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
  "issue",
  "relationship",
  "constraint",
  "temporal",
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

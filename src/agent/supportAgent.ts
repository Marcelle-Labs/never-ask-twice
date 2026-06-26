import type { MemoryPredicate } from "../contracts.js";
import type { MemoryService } from "../memory/service.js";

const requiredPredicates: MemoryPredicate[] = [
  "sla_tier",
  "product_config",
  "integration",
  "escalation_contact",
];

export interface AgentResponse {
  answer: string;
  askedForMissingFacts: boolean;
  citedFacts: string[];
  hallucinatedFacts: string[];
}

export async function runSupportTurn(input: {
  accountId: string;
  customerId: string;
  sessionId: string;
  query: string;
  memoryMode: "on" | "off";
  memoryService: MemoryService;
  now: Date;
}) {
  const recall = await input.memoryService.recall({
    accountId: input.accountId,
    customerId: input.customerId,
    sessionId: input.sessionId,
    query: input.query,
    tokenBudget: 1200,
    now: input.now,
  });

  const effectiveBundle =
    input.memoryMode === "on"
      ? recall.bundle
      : recall.bundle.filter((item) => item.kind === "working");

  const facts = effectiveBundle
    .filter((item) => item.kind !== "episodic")
    .map((item) => item.summary);

  const missingPredicates = requiredPredicates.filter(
    (predicate) => !facts.some((summary) => summary.includes(predicate)),
  );

  if (missingPredicates.length > 0) {
    return {
      answer: `Before I act, I need your ${missingPredicates.join(", ")}.`,
      askedForMissingFacts: true,
      citedFacts: facts,
      hallucinatedFacts: [],
    } satisfies AgentResponse;
  }

  const answer = [
    "I have enough context to proceed.",
    ...facts.map((fact) => `Known: ${fact}`),
    "Routing this to the documented escalation contact now.",
  ].join(" ");

  return {
    answer,
    askedForMissingFacts: false,
    citedFacts: facts,
    hallucinatedFacts: [],
  } satisfies AgentResponse;
}

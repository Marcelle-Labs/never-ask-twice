import type { MemoryPredicate } from "../contracts.js";
import type { MemoryService } from "../memory/service.js";

const DEFAULT_REQUIRED_PREDICATES: MemoryPredicate[] = [
  "sla_tier",
  "product_config",
  "integration",
  "escalation_contact",
];

// How to ask for a missing fact — polite question phrase, no schema names
const PREDICATE_QUESTION: Partial<Record<string, string>> = {
  sla_tier:           "what SLA tier you're on",
  product_config:     "what product configuration you're using",
  integration:        "which integration you're working with",
  escalation_contact: "who your escalation contact is",
  auth_requirement:   "what authentication method you require",
  technical_contact:  "who your technical contact is",
  timezone:           "what timezone you're in",
};

// How to mention a known fact inline — natural prose, no schema names
const PREDICATE_MENTION: Partial<Record<string, (obj: string) => string>> = {
  sla_tier:           (obj) => (obj === "enterprise" || obj === "gold") ? "Gold SLA" : `${obj} SLA`,
  integration:        (obj) => `${obj} integration`,
  product_config:     (obj) => obj,
  escalation_contact: (obj) => obj,
  auth_requirement:   (obj) => `${obj} auth`,
  technical_contact:  (obj) => obj,
  timezone:           (obj) => `${obj} timezone`,
};

function humanMissingQuestion(predicates: string[]): string {
  const phrases = predicates.map((p) => PREDICATE_QUESTION[p] ?? p.replace(/_/g, " "));
  if (phrases.length === 1) return `To help you, could you confirm ${phrases[0]}?`;
  const last = phrases[phrases.length - 1];
  const rest = phrases.slice(0, -1);
  return `To get started, I'll need a few details — ${rest.join(", ")}, and ${last}. Happy to help once I have those.`;
}

function humanFactMention(predicate: string, object: string): string {
  const fn = PREDICATE_MENTION[predicate];
  return fn ? fn(object) : `${predicate.replace(/_/g, " ")} ${object}`;
}

export interface CitedFact {
  summary: string;
  predicate: string;
  object: string;
}

export interface AgentResponse {
  answer: string;
  askedForMissingFacts: boolean;
  citedFacts: CitedFact[];
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
  requiredPredicates?: MemoryPredicate[];
}) {
  const requiredPredicates = input.requiredPredicates ?? DEFAULT_REQUIRED_PREDICATES;
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

  const facts: CitedFact[] = effectiveBundle
    .filter((item) => item.kind !== "episodic")
    .map((item) => {
      const payload = item.payload as { predicate: string; object: string };
      return { summary: item.summary, predicate: payload.predicate, object: payload.object };
    });

  const missingPredicates = requiredPredicates.filter(
    (predicate) => !facts.some((fact) => fact.summary.includes(predicate)),
  );

  if (missingPredicates.length > 0) {
    return {
      answer: humanMissingQuestion(missingPredicates),
      askedForMissingFacts: true,
      citedFacts: facts,
      hallucinatedFacts: [],
    } satisfies AgentResponse;
  }

  const escalationFact = facts.find((f) => f.predicate === "escalation_contact");
  const contextFacts = facts.filter((f) => f.predicate !== "escalation_contact");
  const contextMentions = contextFacts.map((f) => humanFactMention(f.predicate, f.object));
  const routingLine = escalationFact ? `I'll route this to ${escalationFact.object} now.` : "Routing this now.";
  const answer = contextMentions.length > 0
    ? `I have your account details on file — ${contextMentions.join(", ")}. ${routingLine}`
    : routingLine;

  return {
    answer,
    askedForMissingFacts: false,
    citedFacts: facts,
    hallucinatedFacts: [],
  } satisfies AgentResponse;
}

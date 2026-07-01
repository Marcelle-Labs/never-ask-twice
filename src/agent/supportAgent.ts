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

// VR-508: memory-OFF is the control condition — it must keep re-asking every
// turn (repeat-question-rate stays 1.00), just without repeating the exact
// same sentence, so it doesn't read as a stuck loop. One-time acknowledgment
// of the customer's deflection, no ability to resolve without the facts.
const PREDICATE_LOOKUP_HINT: Partial<Record<string, string>> = {
  sla_tier:           "your SLA tier is usually in your account settings",
  product_config:     "your product configuration is on your account's setup page",
  integration:        "the integration name is in your admin console",
  escalation_contact: "your escalation contact is your account's designated support contact",
};

function humanMissingQuestion(predicates: string[], variant = 0): string {
  const phrases = predicates.map((p) => PREDICATE_QUESTION[p] ?? p.replace(/_/g, " "));
  const list = phrases.length === 1
    ? phrases[0]
    : `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;

  if (variant === 1) {
    const hint = PREDICATE_LOOKUP_HINT[predicates[0]];
    return hint
      ? `No problem — ${hint}, or I can confirm it once you give me a bit more. I'll still need ${list} to move forward.`
      : `No problem — I can look that up once you give me a bit more. I'll still need ${list} to move forward.`;
  }

  if (variant === 2) {
    return `I still don't have what I need to help — could you share ${list}?`;
  }

  if (phrases.length === 1) return `To help you, could you confirm ${phrases[0]}?`;
  return `To get started, I'll need a few details — ${list}. Happy to help once I have those.`;
}

function humanFactMention(predicate: string, object: string): string {
  const fn = PREDICATE_MENTION[predicate];
  return fn ? fn(object) : `${predicate.replace(/_/g, " ")} ${object}`;
}

// VR-517: once facts are resolved, the first reply in a session gets the full
// reveal (unchanged — this is the ablation demo beat). Any later turn in the
// same resolved session gets a short, varied acknowledgment instead of
// repeating the full fact list every time.
const ALREADY_RESOLVED_ACKS: Array<(contact: string | null) => string> = [
  (contact) => contact
    ? `Still working on getting this over to ${contact} — nothing's changed on my end.`
    : "Still working this one — nothing's changed on my end.",
  (contact) => contact
    ? `Yep, still with you — this is already on its way to ${contact}.`
    : "Yep, still with you — this is already moving.",
  (contact) => contact
    ? `Nothing new to add — ${contact} already has what's needed to pick this up.`
    : "Nothing new to add — this is already in motion.",
];

// customerTurns is the total count of customer turns in this session so far,
// INCLUDING the current one (matches the counting convention already used
// for VR-508 below). Only called when customerTurns >= 2.
function humanAlreadyResolvedAck(customerTurns: number, contact: string | null): string {
  const variant = (customerTurns - 2) % ALREADY_RESOLVED_ACKS.length;
  return ALREADY_RESOLVED_ACKS[variant](contact);
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
    // VR-508: vary phrasing across turns in memory-OFF only — memory-ON keeps
    // its original wording untouched. Turn count must be scoped to THIS
    // session, in chronological order — recall.bundle is score-ranked and
    // token-budget-filtered (drops/reorders entries) and getAllEvents spans
    // every session this customer has ever had, so neither is a reliable
    // per-conversation counter. store.getEvents(sessionId) is.
    let variant = 0;
    if (input.memoryMode === "off") {
      const sessionEvents = await input.memoryService.store.getEvents(input.sessionId);
      const customerTurns = sessionEvents.filter((event) => event.role === "customer").length;
      variant = Math.max(0, customerTurns - 1) % 3;
    }

    return {
      answer: humanMissingQuestion(missingPredicates, variant),
      askedForMissingFacts: true,
      citedFacts: facts,
      hallucinatedFacts: [],
    } satisfies AgentResponse;
  }

  const escalationFact = facts.find((f) => f.predicate === "escalation_contact");
  const contextFacts = facts.filter((f) => f.predicate !== "escalation_contact");
  const contextMentions = contextFacts.map((f) => humanFactMention(f.predicate, f.object));
  const routingLine = escalationFact ? `I'll route this to ${escalationFact.object} now.` : "Routing this now.";
  const fullReveal = contextMentions.length > 0
    ? `I have your account details on file — ${contextMentions.join(", ")}. ${routingLine}`
    : routingLine;

  // VR-517: only the first resolved reply in a session gets the full reveal —
  // that's the ablation demo beat and must stay exactly as-is. Later turns in
  // the same resolved session get a varied acknowledgment instead of
  // repeating the full fact list every time.
  const sessionEvents = await input.memoryService.store.getEvents(input.sessionId);
  const customerTurns = sessionEvents.filter((event) => event.role === "customer").length;
  const answer = customerTurns <= 1
    ? fullReveal
    : humanAlreadyResolvedAck(customerTurns, escalationFact?.object ?? null);

  return {
    answer,
    askedForMissingFacts: false,
    citedFacts: facts,
    hallucinatedFacts: [],
  } satisfies AgentResponse;
}

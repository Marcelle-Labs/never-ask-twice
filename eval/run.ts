import { readFileSync } from "node:fs";
import path from "node:path";

import { runSupportTurn } from "../src/agent/supportAgent.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "../src/testing/fakeQwenClient.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentEvalResult = {
  mode: "on" | "off";
  reAskRate: number;
  recallAccuracy: number;
  hallucinationCount: number;
};

// ─── Scenario 1: basic-recall (Acme Robotics) ────────────────────────────────

const repoRoot = process.cwd();
const scenario = JSON.parse(readFileSync(path.join(repoRoot, "eval/scenario.json"), "utf8")) as {
  accountId: string;
  customerId: string;
  sessions: Array<{ sessionId: string; openedAt: string; turns: Array<{ role: string; message: string }> }>;
};
const groundTruth = JSON.parse(readFileSync(path.join(repoRoot, "eval/ground_truth.json"), "utf8")) as {
  requiredFacts: Record<string, string>;
  expectedManagerFacts: string[];
};
const expectedOutput = JSON.parse(readFileSync(path.join(repoRoot, "eval/expected-output.json"), "utf8")) as {
  managerSummaryLine: string;
  supersessionVerified: boolean;
  forgettingVerified: boolean;
};

function createAcmeHarness() {
  const qwen = new FakeQwenClient();
  const setupMessage = scenario.sessions[0].turns[0].message;
  const followUp = scenario.sessions[1].turns[0].message;
  const summaryPrompt = scenario.sessions[2].turns[0].message;

  qwen.setEmbedding(setupMessage, 21);
  qwen.setEmbedding(followUp, 22);
  qwen.setEmbedding(summaryPrompt, 23);
  qwen.setEmbedding("Acme Robotics sla_tier gold", 24);
  qwen.setEmbedding("Acme Robotics product_config requires SSO", 25);
  qwen.setEmbedding("Acme Robotics integration Salesforce", 26);
  qwen.setEmbedding("Acme Robotics escalation_contact Priya", 27);
  qwen.setDistillation(`customer: ${setupMessage}`, [
    { subject: "Acme Robotics", predicate: "sla_tier", predicateClass: "contract", object: "gold", confidence: 0.95, metadata: {} },
    { subject: "Acme Robotics", predicate: "product_config", predicateClass: "configuration", object: "requires SSO", confidence: 0.95, metadata: {} },
    { subject: "Acme Robotics", predicate: "integration", predicateClass: "configuration", object: "Salesforce", confidence: 0.95, metadata: {} },
    { subject: "Acme Robotics", predicate: "escalation_contact", predicateClass: "relationship", object: "Priya", confidence: 0.95, metadata: {} },
  ]);

  return new MemoryService(new InMemoryMemoryStore(), qwen);
}

async function runScenario1(mode: "on" | "off"): Promise<AgentEvalResult> {
  const memoryService = createAcmeHarness();

  await memoryService.createSession({
    accountId: scenario.accountId,
    customerId: scenario.customerId,
    sessionId: scenario.sessions[0].sessionId,
  });
  await memoryService.appendTurn({
    accountId: scenario.accountId,
    customerId: scenario.customerId,
    sessionId: scenario.sessions[0].sessionId,
    role: "customer",
    message: scenario.sessions[0].turns[0].message,
    ts: new Date(scenario.sessions[0].openedAt),
  });
  await memoryService.closeSession({
    sessionId: scenario.sessions[0].sessionId,
    accountId: scenario.accountId,
    customerId: scenario.customerId,
    closedAt: new Date("2026-06-25T09:10:00.000Z"),
  });

  await memoryService.createSession({
    accountId: scenario.accountId,
    customerId: scenario.customerId,
    sessionId: scenario.sessions[1].sessionId,
  });

  const agentTurn = await runSupportTurn({
    accountId: scenario.accountId,
    customerId: scenario.customerId,
    sessionId: scenario.sessions[1].sessionId,
    query: scenario.sessions[1].turns[0].message,
    memoryMode: mode,
    memoryService,
    now: new Date(scenario.sessions[1].openedAt),
  });

  const expectedFacts = groundTruth.expectedManagerFacts;
  const citedExpected = agentTurn.citedFacts.filter((fact) =>
    expectedFacts.some((expected) => fact.includes(expected)),
  );

  return {
    mode,
    reAskRate: agentTurn.askedForMissingFacts ? 1 : 0,
    recallAccuracy: citedExpected.length / expectedFacts.length,
    hallucinationCount: agentTurn.hallucinatedFacts.length,
  };
}

// ─── Scenario 2: globex-preference-change (Supersession) ─────────────────────
// Globex's technical contact changes from Amanda → Bob across two sessions.
// Supersession must retire the Amanda fact so only Bob appears at recall time.

async function runScenario2(): Promise<{ supersededFactGone: boolean; updatedFactPresent: boolean }> {
  const qwen = new FakeQwenClient();
  const accountId = "acct-never-ask-twice";
  const customerId = "cust-globex";
  const msg1 = "Globex Corp here. Our technical contact is Amanda. We are on the enterprise product plan.";
  const msg2 = "Update: our technical contact changed. Bob from IT handles our account now.";
  const query = "Who is Globex Corp's technical contact?";

  qwen.setEmbedding(msg1, 31);
  qwen.setEmbedding(msg2, 32);
  qwen.setEmbedding(query, 33);
  qwen.setEmbedding("Globex Corp technical_contact Amanda", 34);
  qwen.setEmbedding("Globex Corp technical_contact Bob", 35);
  qwen.setEmbedding("Globex Corp product_plan enterprise", 36);

  qwen.setDistillation(`customer: ${msg1}`, [
    { subject: "Globex Corp", predicate: "technical_contact", predicateClass: "relationship", object: "Amanda", confidence: 0.95, metadata: {} },
    { subject: "Globex Corp", predicate: "product_plan", predicateClass: "contract", object: "enterprise", confidence: 0.95, metadata: {} },
  ]);
  qwen.setDistillation(`customer: ${msg2}`, [
    { subject: "Globex Corp", predicate: "technical_contact", predicateClass: "relationship", object: "Bob", confidence: 0.95, metadata: {} },
  ]);

  const memoryService = new MemoryService(new InMemoryMemoryStore(), qwen);
  const session1ClosedAt = new Date("2026-06-25T09:10:00.000Z");
  const session2ClosedAt = new Date("2026-06-25T10:10:00.000Z");
  const recallNow = new Date("2026-06-26T09:00:00.000Z");

  await memoryService.createSession({ accountId, customerId, sessionId: "globex-s1" });
  await memoryService.appendTurn({ accountId, customerId, sessionId: "globex-s1", role: "customer", message: msg1, ts: new Date("2026-06-25T09:00:00.000Z") });
  await memoryService.closeSession({ sessionId: "globex-s1", accountId, customerId, closedAt: session1ClosedAt });

  await memoryService.createSession({ accountId, customerId, sessionId: "globex-s2" });
  await memoryService.appendTurn({ accountId, customerId, sessionId: "globex-s2", role: "customer", message: msg2, ts: new Date("2026-06-25T10:00:00.000Z") });
  await memoryService.closeSession({ sessionId: "globex-s2", accountId, customerId, closedAt: session2ClosedAt });

  const recall = await memoryService.recall({ accountId, customerId, query, tokenBudget: 1200, now: recallNow });
  const summaries = recall.bundle.filter((item) => item.kind !== "episodic").map((item) => item.summary);

  return {
    supersededFactGone: !summaries.some((s) => s.includes("Amanda")),
    updatedFactPresent: summaries.some((s) => s.includes("Bob")),
  };
}

// ─── Scenario 3: initech-expired-fact (TTL Forgetting) ───────────────────────
// Initech shares a temp token valid for 1 day. When recalled 3 days later the
// fact must be absent — expiresAt has passed and currentFacts() filters it out.

async function runScenario3(): Promise<{ expiredFactGone: boolean }> {
  const qwen = new FakeQwenClient();
  const accountId = "acct-never-ask-twice";
  const customerId = "cust-initech";
  const msg1 = "Initech here. We have a temporary access token TOKEN-999, valid for 1 day only.";
  const query = "Does Initech have an active temporary token?";

  qwen.setEmbedding(msg1, 41);
  qwen.setEmbedding(query, 42);
  qwen.setEmbedding("Initech known_constraint TOKEN-999", 43);

  qwen.setDistillation(`customer: ${msg1}`, [
    { subject: "Initech", predicate: "known_constraint", predicateClass: "temporal", object: "TOKEN-999", confidence: 0.95, ttlDays: 1, metadata: {} },
  ]);

  const memoryService = new MemoryService(new InMemoryMemoryStore(), qwen);
  const sessionClosedAt = new Date("2026-06-25T09:10:00.000Z");
  // 3 days later: expiresAt = closedAt + 1 day < recallNow
  const recallNow = new Date("2026-06-28T09:10:00.000Z");

  await memoryService.createSession({ accountId, customerId, sessionId: "initech-s1" });
  await memoryService.appendTurn({ accountId, customerId, sessionId: "initech-s1", role: "customer", message: msg1, ts: new Date("2026-06-25T09:00:00.000Z") });
  await memoryService.closeSession({ sessionId: "initech-s1", accountId, customerId, closedAt: sessionClosedAt });

  const recall = await memoryService.recall({ accountId, customerId, query, tokenBudget: 1200, now: recallNow });
  const summaries = recall.bundle.filter((item) => item.kind !== "episodic").map((item) => item.summary);

  return {
    expiredFactGone: !summaries.some((s) => s.includes("TOKEN-999")),
  };
}

// ─── Assertions ───────────────────────────────────────────────────────────────

function assertScenario1(on: AgentEvalResult, off: AgentEvalResult) {
  if (on.reAskRate !== 0) throw new Error("scenario:basic-recall memory-on regressed: re-asked for known facts");
  if (off.reAskRate !== 1) throw new Error("scenario:basic-recall memory-off baseline broken: did not ask for missing facts");
  if (expectedOutput.managerSummaryLine !== "re-ask rate: 0.00 (memory) vs 1.00 (no-memory)") {
    throw new Error("expected-output.json fixture changed unexpectedly");
  }
}

function assertScenario2(result: { supersededFactGone: boolean; updatedFactPresent: boolean }) {
  if (!result.supersededFactGone) throw new Error("scenario:globex-preference-change failed: stale Amanda fact still present after supersession");
  if (!result.updatedFactPresent) throw new Error("scenario:globex-preference-change failed: updated Bob fact not found in recall");
  if (!expectedOutput.supersessionVerified) throw new Error("expected-output.json does not expect supersession to be verified");
}

function assertScenario3(result: { expiredFactGone: boolean }) {
  if (!result.expiredFactGone) throw new Error("scenario:initech-expired-fact failed: TOKEN-999 still present after TTL expiry");
  if (!expectedOutput.forgettingVerified) throw new Error("expected-output.json does not expect forgetting to be verified");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const onResult = await runScenario1("on");
  const offResult = await runScenario1("off");
  assertScenario1(onResult, offResult);

  const s2 = await runScenario2();
  assertScenario2(s2);

  const s3 = await runScenario3();
  assertScenario3(s3);

  const combinedLine = `re-ask rate: ${onResult.reAskRate.toFixed(2)} (memory) vs ${offResult.reAskRate.toFixed(2)} (no-memory)`;

  console.log("=== scenario:basic-recall ===");
  console.log(`memory-on  re-ask rate:      ${onResult.reAskRate.toFixed(2)}`);
  console.log(`memory-on  recall accuracy:  ${onResult.recallAccuracy.toFixed(2)}`);
  console.log(`memory-on  hallucinations:   ${onResult.hallucinationCount}`);
  console.log(`memory-off re-ask rate:      ${offResult.reAskRate.toFixed(2)}`);
  console.log(`memory-off recall accuracy:  ${offResult.recallAccuracy.toFixed(2)}`);
  console.log(`memory-off hallucinations:   ${offResult.hallucinationCount}`);
  console.log(combinedLine);

  console.log("=== scenario:globex-preference-change ===");
  console.log(`superseded fact gone:  ${s2.supersededFactGone}`);
  console.log(`updated fact present:  ${s2.updatedFactPresent}`);
  console.log(`supersession:          ${s2.supersededFactGone && s2.updatedFactPresent ? "PASS" : "FAIL"}`);

  console.log("=== scenario:initech-expired-fact ===");
  console.log(`expired fact gone:     ${s3.expiredFactGone}`);
  console.log(`ttl-forgetting:        ${s3.expiredFactGone ? "PASS" : "FAIL"}`);

  console.log("=== aggregate ===");
  console.log(`re-ask ON: ${onResult.reAskRate.toFixed(2)} | re-ask OFF: ${offResult.reAskRate.toFixed(2)} | recall accuracy: ${onResult.recallAccuracy.toFixed(2)} | hallucinations: ${onResult.hallucinationCount} | supersession: PASS | ttl-forgetting: PASS`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

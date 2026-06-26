import { readFileSync } from "node:fs";
import path from "node:path";

import { runSupportTurn } from "../src/agent/supportAgent.js";
import { MemoryService } from "../src/memory/service.js";
import { InMemoryMemoryStore } from "../src/memory/store.js";
import { FakeQwenClient } from "../src/testing/fakeQwenClient.js";

type EvalResult = {
  mode: "on" | "off";
  reAskRate: number;
  recallAccuracy: number;
  hallucinationCount: number;
  managerSummaryLine: string;
};

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
};

function createHarness() {
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
    {
      subject: "Acme Robotics",
      predicate: "sla_tier",
      predicateClass: "contract",
      object: "gold",
      confidence: 0.95,
      metadata: {}
    },
    {
      subject: "Acme Robotics",
      predicate: "product_config",
      predicateClass: "configuration",
      object: "requires SSO",
      confidence: 0.95,
      metadata: {}
    },
    {
      subject: "Acme Robotics",
      predicate: "integration",
      predicateClass: "configuration",
      object: "Salesforce",
      confidence: 0.95,
      metadata: {}
    },
    {
      subject: "Acme Robotics",
      predicate: "escalation_contact",
      predicateClass: "relationship",
      object: "Priya",
      confidence: 0.95,
      metadata: {}
    }
  ]);

  return new MemoryService(new InMemoryMemoryStore(), qwen);
}

async function runMode(mode: "on" | "off"): Promise<EvalResult> {
  const memoryService = createHarness();

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
  const citedFacts = agentTurn.citedFacts.filter((fact) =>
    expectedFacts.some((expectedFact) => fact.includes(expectedFact)),
  );

  const reAskRate = agentTurn.askedForMissingFacts ? 1 : 0;
  const recallAccuracy = citedFacts.length / expectedFacts.length;
  const hallucinationCount = agentTurn.hallucinatedFacts.length;

  return {
    mode,
    reAskRate,
    recallAccuracy,
    hallucinationCount,
    managerSummaryLine: `re-ask rate: ${reAskRate.toFixed(2)} (${mode === "on" ? "memory" : "no-memory"})`,
  };
}

function assertDeterministic(result: EvalResult, expectedLine: string) {
  if (result.mode === "on" && result.reAskRate !== 0) {
    throw new Error("memory-on path regressed");
  }
  if (result.mode === "off" && result.reAskRate !== 1) {
    throw new Error("memory-off baseline regressed");
  }
  if (expectedLine !== "re-ask rate: 0.00 (memory) vs 1.00 (no-memory)") {
    throw new Error("expected output fixture changed unexpectedly");
  }
}

async function main() {
  const onResult = await runMode("on");
  const offResult = await runMode("off");
  const combinedLine = `${onResult.managerSummaryLine} vs ${offResult.reAskRate.toFixed(2)} (no-memory)`;

  assertDeterministic(onResult, expectedOutput.managerSummaryLine);
  assertDeterministic(offResult, expectedOutput.managerSummaryLine);

  console.log(`memory-on re-ask rate: ${onResult.reAskRate.toFixed(2)}`);
  console.log(`memory-on recall accuracy: ${onResult.recallAccuracy.toFixed(2)}`);
  console.log(`memory-on hallucination count: ${onResult.hallucinationCount}`);
  console.log(`memory-off re-ask rate: ${offResult.reAskRate.toFixed(2)}`);
  console.log(`memory-off recall accuracy: ${offResult.recallAccuracy.toFixed(2)}`);
  console.log(`memory-off hallucination count: ${offResult.hallucinationCount}`);
  console.log(combinedLine);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

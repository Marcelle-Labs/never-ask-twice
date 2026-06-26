import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const expectedOutput = JSON.parse(readFileSync(path.join(repoRoot, "eval/expected-output.json"), "utf8")) as {
  managerSummaryLine: string;
};
const groundTruth = JSON.parse(readFileSync(path.join(repoRoot, "eval/ground_truth.json"), "utf8")) as {
  expectedManagerFacts: string[];
};
const scenario = JSON.parse(readFileSync(path.join(repoRoot, "eval/scenario.json"), "utf8")) as {
  sessions: unknown[];
};

const aligned =
  scenario.sessions.length === 3 &&
  groundTruth.expectedManagerFacts.length === 4 &&
  expectedOutput.managerSummaryLine === "re-ask rate: 0.00 (memory) vs 1.00 (no-memory)";

if (!aligned) {
  console.error("demo-script-check: misaligned");
  process.exit(1);
}

console.log("demo-script-check: aligned");

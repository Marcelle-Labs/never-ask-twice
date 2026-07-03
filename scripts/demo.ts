import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const isLive = args.includes("--live");

const BASE_URL = process.env.DEMO_BASE_URL ?? "https://neverasktwice.dev";

function printUsage() {
  console.log(`
Never Ask Twice — Demo automation

Usage:
  pnpm demo --dry-run    Run preflight validation (headed, with traces)
  pnpm demo --live        Run recording driver for OBS screen capture

Environment:
  DEMO_BASE_URL           Target URL (default: ${BASE_URL})

Preflight:
  Runs tests/demo-preflight.spec.ts via Playwright.
  Opens a trace on failure: npx playwright show-trace test-results/**/trace.zip

Recording:
  Runs scripts/record-demo.ts via tsx.
  Launches a headed browser at 1920x1080 with slowMo for screen capture.
`);
}

if (!isDryRun && !isLive) {
  printUsage();
  process.exit(0);
}

if (isDryRun) {
  console.log(`[demo] Preflight validation against ${BASE_URL}`);
  try {
    execSync(
      `npx playwright test tests/demo-preflight.spec.ts --headed --project=chromium --trace on`,
      {
        stdio: "inherit",
        env: { ...process.env, DEMO_BASE_URL: BASE_URL },
      },
    );
    console.log("[demo] Preflight PASSED — ready to record");
  } catch {
    console.error("[demo] Preflight FAILED — fix issues before recording");
    console.error("[demo] Inspect trace: npx playwright show-trace test-results/**/trace.zip");
    process.exit(1);
  }
}

if (isLive) {
  console.log(`[demo] Recording driver against ${BASE_URL}`);
  console.log("[demo] Start OBS screen capture now, then press Enter to begin...");
  try {
    execSync(`npx tsx scripts/record-demo.ts`, {
      stdio: "inherit",
      env: { ...process.env, DEMO_BASE_URL: BASE_URL },
    });
    console.log("[demo] Recording complete");
  } catch {
    console.error("[demo] Recording failed");
    process.exit(1);
  }
}

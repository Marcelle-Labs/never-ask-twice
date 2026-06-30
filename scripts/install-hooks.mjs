import { chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

if (!existsSync(".git")) {
  // No git directory in this checkout (e.g. a platform build snapshot) — nothing to hook.
  process.exit(0);
}

if (existsSync(".githooks/pre-push")) {
  chmodSync(".githooks/pre-push", 0o755);
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});

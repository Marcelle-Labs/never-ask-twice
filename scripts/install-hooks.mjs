import { chmodSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

if (existsSync(".githooks/pre-push")) {
  chmodSync(".githooks/pre-push", 0o755);
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
});

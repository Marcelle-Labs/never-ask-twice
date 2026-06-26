import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";

import { createSeededMcpRuntime } from "../src/mcp/bootstrap.js";
import { recallMemory } from "../src/mcp/runtime.js";

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(input)) {
      if (key === "factId" || key === "eventId") {
        continue;
      }
      output[key] = normalize(nested);
    }

    return output;
  }

  return value;
}

function callServer(message: Record<string, unknown>) {
  return new Promise<unknown>((resolve, reject) => {
    const child = spawn("node", ["dist/src/mcp/server.js"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `server exited with ${code}`));
        return;
      }

      const lines = stdout.trim().split("\n");
      resolve(JSON.parse(lines.at(-1) ?? "{}"));
    });

    child.stdin.write(`${JSON.stringify(message)}\n`);
    child.stdin.end();
  });
}

describe("mcp-parity", () => {
  it("returns the same recall payload over MCP and in-process", async () => {
    execFileSync("pnpm", ["build"], {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    const runtime = await createSeededMcpRuntime();
    const args = {
      account_id: "acct-1",
      customer_id: "cust-1",
      session_id: "sess-2",
      query: "Can you route the Salesforce outage without making me repeat the setup?",
    };

    const direct = await recallMemory(runtime, args);
    const viaServer = (await callServer({
      id: 1,
      method: "call_tool",
      params: {
        name: "recall_memory",
        args,
      },
    })) as { result: typeof direct };

    expect(normalize(viaServer.result)).toEqual(normalize(direct));
  });
});

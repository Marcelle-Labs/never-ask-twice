import readline from "node:readline";

import { createSeededMcpRuntime } from "./bootstrap.js";
import { callMcpTool } from "./runtime.js";
import { mcpToolDefinitions } from "./tools.js";

interface RequestMessage {
  id: string | number;
  method: "list_tools" | "call_tool";
  params?: Record<string, unknown>;
}

async function main() {
  const runtime = await createSeededMcpRuntime();
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) {
      continue;
    }

    const request = JSON.parse(line) as RequestMessage;

    try {
      if (request.method === "list_tools") {
        process.stdout.write(
          JSON.stringify({
            id: request.id,
            result: mcpToolDefinitions,
          }) + "\n",
        );
        continue;
      }

      if (request.method === "call_tool") {
        const toolName = String(request.params?.name ?? "");
        const args = (request.params?.args as Record<string, unknown> | undefined) ?? {};
        const result = await callMcpTool(runtime, toolName, args as never);
        process.stdout.write(
          JSON.stringify({
            id: request.id,
            result,
          }) + "\n",
        );
        continue;
      }

      throw new Error(`Unsupported method: ${request.method}`);
    } catch (error) {
      process.stdout.write(
        JSON.stringify({
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        }) + "\n",
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

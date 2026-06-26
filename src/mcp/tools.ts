import type { McpToolDefinition } from "./types.js";

export const mcpToolDefinitions: McpToolDefinition[] = [
  {
    name: "recall_memory",
    description: "Return the bounded memory bundle for an account, customer, and query.",
  },
  {
    name: "write_memory",
    description: "Append episodic events to a session using the shared memory service.",
  },
  {
    name: "distill_session",
    description: "Run session-close distillation using the shared memory service.",
  },
  {
    name: "forget",
    description: "Expire or supersede current facts by fact id or predicate class.",
  },
];

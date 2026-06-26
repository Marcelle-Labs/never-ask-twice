import type { MemoryService } from "../memory/service.js";
import type { SemanticFactRecord } from "../memory/types.js";
import type { McpRuntime } from "./bootstrap.js";
import type { DistillSessionArgs, ForgetArgs, RecallMemoryArgs, WriteMemoryArgs } from "./types.js";

function getSessionTenant(
  runtime: McpRuntime,
  sessionId: string,
) {
  const tenant = runtime.sessionIndex.get(sessionId);
  if (!tenant) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return tenant;
}

function summarizeFact(fact: SemanticFactRecord) {
  return `${fact.subject} ${fact.predicate} ${fact.object}`;
}

function parseTimestamp(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ISO timestamp for ${field}: ${value}`);
  }
  return date;
}

export async function recallMemory(runtime: McpRuntime, args: RecallMemoryArgs) {
  return runtime.memoryService.recall({
    accountId: args.account_id,
    customerId: args.customer_id,
    sessionId: args.session_id,
    query: args.query,
    tokenBudget: 1200,
    now: args.now ? parseTimestamp(args.now, "now") : new Date(),
  });
}

export async function writeMemory(runtime: McpRuntime, args: WriteMemoryArgs) {
  const tenant = getSessionTenant(runtime, args.session_id);
  const writes = [];

  for (const event of args.events) {
    writes.push(
      await runtime.memoryService.appendTurn({
        accountId: tenant.accountId,
        customerId: tenant.customerId,
        sessionId: args.session_id,
        role: event.role,
        message: event.message,
        ts: new Date(event.ts),
      }),
    );
  }

  return {
    written: writes.length,
    eventIds: writes.map((item) => item.eventId),
  };
}

export async function distillSession(runtime: McpRuntime, args: DistillSessionArgs) {
  const tenant = getSessionTenant(runtime, args.session_id);
  const result = await runtime.memoryService.closeSession({
    sessionId: args.session_id,
    accountId: tenant.accountId,
    customerId: tenant.customerId,
    closedAt: args.closed_at ? new Date(args.closed_at) : new Date(),
  });

  return {
    sessionId: result.session.sessionId,
    factsWritten: result.facts.length,
    facts: result.facts.map(summarizeFact),
  };
}

export async function forget(runtime: McpRuntime, args: ForgetArgs) {
  const now = new Date();
  const factsToUpdate: SemanticFactRecord[] = [];
  const changed: string[] = [];

  if (args.fact_id) {
    const fact = await runtime.memoryService.store.getFactById(args.fact_id);
    if (fact && fact.validTo === null) {
      factsToUpdate.push(fact);
    }
  }

  if (args.predicate_class) {
    const facts = await runtime.memoryService.store.getFactsByPredicateClass(args.predicate_class);
    factsToUpdate.push(...facts.filter((f) => f.validTo === null));
  }

  // Dedup by factId to avoid double updates
  const dedupedFacts = new Map<string, SemanticFactRecord>();
  for (const fact of factsToUpdate) {
    dedupedFacts.set(fact.factId, fact);
  }

  await Promise.all(
    Array.from(dedupedFacts.values()).map(async (fact) => {
      await runtime.memoryService.store.updateSemanticFact(fact.factId, { validTo: now });
      changed.push(fact.factId);
    }),
  );

  return {
    forgotten: Array.from(new Set(changed)),
  };
}

export async function callMcpTool(
  runtime: McpRuntime,
  name: string,
  args: RecallMemoryArgs | WriteMemoryArgs | DistillSessionArgs | ForgetArgs,
) {
  switch (name) {
    case "recall_memory":
      return recallMemory(runtime, args as RecallMemoryArgs);
    case "write_memory":
      return writeMemory(runtime, args as WriteMemoryArgs);
    case "distill_session":
      return distillSession(runtime, args as DistillSessionArgs);
    case "forget":
      return forget(runtime, args as ForgetArgs);
    default:
      throw new Error(`Unknown MCP tool: ${name}`);
  }
}

export interface RecallMemoryArgs {
  account_id: string;
  customer_id: string;
  query: string;
  session_id?: string;
}

export interface WriteMemoryArgs {
  session_id: string;
  events: Array<{
    role: "customer" | "agent";
    message: string;
    ts: string;
  }>;
}

export interface DistillSessionArgs {
  session_id: string;
  closed_at?: string;
}

export interface ForgetArgs {
  fact_id?: string;
  predicate_class?: string;
}

export interface McpToolDefinition {
  name: "recall_memory" | "write_memory" | "distill_session" | "forget";
  description: string;
}

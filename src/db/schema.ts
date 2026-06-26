import { sql } from "drizzle-orm";
import { check, customType, index, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1024})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
});

export const accounts = pgTable("accounts", {
  accountId: uuid("account_id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const customers = pgTable("customers", {
  customerId: uuid("customer_id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => accounts.accountId),
  externalRef: text("external_ref").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  sessionId: text("session_id").primaryKey(),
  accountId: text("account_id").notNull(),
  customerId: text("customer_id").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  distilledAt: timestamp("distilled_at", { withTimezone: true }),
  distillationStatus: text("distillation_status").default("open").notNull(),
});

export const episodicEvents = pgTable(
  "episodic_events",
  {
    eventId: uuid("event_id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    customerId: text("customer_id").notNull(),
    sessionId: text("session_id").notNull().references(() => sessions.sessionId),
    role: text("role").notNull(),
    message: text("message").notNull(),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
  },
  (table) => ({
    customerTsIdx: index("episodic_events_customer_ts_idx").on(table.accountId, table.customerId, table.ts),
  }),
);

export const semanticFacts = pgTable(
  "semantic_facts",
  {
    factId: uuid("fact_id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    customerId: text("customer_id").notNull(),
    sessionId: text("session_id").references(() => sessions.sessionId),
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    predicateClass: text("predicate_class").notNull(),
    object: text("object").notNull(),
    confidence: real("confidence").notNull(),
    adjudicationRationale: text("adjudication_rationale"),
    validFrom: timestamp("valid_from", { withTimezone: true }).defaultNow().notNull(),
    validTo: timestamp("valid_to", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
    metadata: jsonb("metadata").default({}).notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  },
  (table) => [
    check("confidence_check", sql`${table.confidence} >= 0 AND ${table.confidence} <= 1`),
    uniqueIndex("semantic_facts_one_current_fact")
      .on(table.accountId, table.customerId, table.subject, table.predicate)
      .where(sql`${table.validTo} IS NULL`),
  ],
);

export const semanticFactProvenance = pgTable(
  "semantic_fact_provenance",
  {
    factId: uuid("fact_id").notNull().references(() => semanticFacts.factId),
    eventId: uuid("event_id").notNull().references(() => episodicEvents.eventId),
    weight: real("weight").notNull(),
    rationale: text("rationale"),
  },
  (table) => [
    primaryKey({
      name: "semantic_fact_provenance_pkey",
      columns: [table.factId, table.eventId],
    }),
  ],
);

export const forgettingPolicy = pgTable("forgetting_policy", {
  policyId: uuid("policy_id").defaultRandom().primaryKey(),
  predicate: text("predicate").notNull(),
  ttlDays: real("ttl_days"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

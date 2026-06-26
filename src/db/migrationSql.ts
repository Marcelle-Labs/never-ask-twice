export const initialMigrationSql = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS accounts (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(account_id),
  external_ref text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(account_id),
  customer_id uuid NOT NULL REFERENCES customers(customer_id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  distilled_at timestamptz NULL,
  distillation_status text NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS episodic_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(account_id),
  customer_id uuid NOT NULL REFERENCES customers(customer_id),
  session_id uuid NOT NULL REFERENCES sessions(session_id),
  role text NOT NULL,
  message text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  embedding vector(1024) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS semantic_facts (
  fact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(account_id),
  customer_id uuid NOT NULL REFERENCES customers(customer_id),
  session_id uuid NULL REFERENCES sessions(session_id),
  subject text NOT NULL,
  predicate text NOT NULL,
  predicate_class text NOT NULL,
  object text NOT NULL,
  confidence real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  adjudication_rationale text NULL,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz NULL,
  expires_at timestamptz NULL,
  superseded_by uuid NULL REFERENCES semantic_facts(fact_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1024) NOT NULL
);

CREATE TABLE IF NOT EXISTS semantic_fact_provenance (
  fact_id uuid NOT NULL REFERENCES semantic_facts(fact_id),
  event_id uuid NOT NULL REFERENCES episodic_events(event_id),
  weight real NOT NULL,
  rationale text NULL,
  PRIMARY KEY (fact_id, event_id)
);

CREATE TABLE IF NOT EXISTS forgetting_policy (
  policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  predicate text NOT NULL,
  ttl_days real NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS semantic_facts_one_current_fact
ON semantic_facts(account_id, customer_id, subject, predicate)
WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS episodic_events_customer_ts_idx
ON episodic_events(account_id, customer_id, ts DESC);
`;

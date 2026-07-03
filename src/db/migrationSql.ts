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
  session_id text PRIMARY KEY,
  account_id text NOT NULL,
  customer_id text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz NULL,
  distilled_at timestamptz NULL,
  distillation_status text NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS episodic_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  customer_id text NOT NULL,
  session_id text NOT NULL REFERENCES sessions(session_id),
  role text NOT NULL,
  message text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  embedding vector(1024) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS semantic_facts (
  fact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL,
  customer_id text NOT NULL,
  session_id text NULL REFERENCES sessions(session_id),
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

-- Replace the old unique index that included subject in the key.
-- Subject is display/provenance text, not an identity boundary — Qwen returns
-- varying subject strings across distillation runs, which caused duplicate
-- facts for the same logical predicate.
DROP INDEX IF EXISTS semantic_facts_one_current_fact;

-- Supersede duplicate current facts per (account_id, customer_id, predicate),
-- keeping only the newest by valid_from. This must run before recreating the
-- unique index to avoid constraint violations.
UPDATE semantic_facts AS s
SET valid_to = s2.valid_from, superseded_by = s2.fact_id
FROM (
  SELECT DISTINCT ON (account_id, customer_id, predicate)
    fact_id, account_id, customer_id, predicate, valid_from
  FROM semantic_facts
  WHERE valid_to IS NULL
  ORDER BY account_id, customer_id, predicate, valid_from DESC, fact_id DESC
) AS s2
WHERE s.account_id = s2.account_id
  AND s.customer_id = s2.customer_id
  AND s.predicate = s2.predicate
  AND s.fact_id <> s2.fact_id
  AND s.valid_to IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS semantic_facts_one_current_fact
ON semantic_facts(account_id, customer_id, predicate)
WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS episodic_events_customer_ts_idx
ON episodic_events(account_id, customer_id, ts DESC);
`;

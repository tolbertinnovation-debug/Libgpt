// Additive migration v1. Only the Build controls use these dedicated tables.
export const GOVERNANCE_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS public.grandpa_ai_governance_state (
  scope text PRIMARY KEY,
  ledger jsonb NOT NULL,
  audit_bytes bigint NOT NULL DEFAULT 0 CHECK (audit_bytes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.grandpa_ai_governance_audit (
  scope text NOT NULL REFERENCES public.grandpa_ai_governance_state(scope),
  sequence bigint NOT NULL CHECK (sequence > 0),
  record text NOT NULL,
  PRIMARY KEY (scope, sequence)
);`;

-- Paramétrage connexion base BI en base applicative (source unique)
-- node scripts/db-exec.cjs migrations/20260508133000_bi_connection_settings.sql

CREATE TABLE IF NOT EXISTS public.bi_connection_settings (
  id boolean PRIMARY KEY DEFAULT true,
  connection_string text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_connection_settings_singleton_chk CHECK (id = true)
);


-- Source BI en base (remplace le fichier config/bi-data-tables.json à l'exécution)
-- node scripts/db-exec.cjs migrations/20260508131500_bi_allowed_tables.sql

CREATE TABLE IF NOT EXISTS public.bi_allowed_tables (
  table_name varchar(255) PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed initial (idempotent)
INSERT INTO public.bi_allowed_tables (table_name)
VALUES
  ('irradiance'),
  ('production'),
  ('puissance_installee'),
  ('vente_carburant')
ON CONFLICT (table_name) DO NOTHING;

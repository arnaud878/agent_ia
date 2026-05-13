-- Prompts agent BI : le texte effectif est en colonne `body`, rempli au premier démarrage
-- depuis les modèles d'installation du code (`bi-prompt-install-defaults.ts`) si `body` est vide.
-- Plus de duplication dans des fichiers .txt.
-- node scripts/db-exec.cjs migrations/20260513120000_bi_agent_prompts.sql

CREATE TABLE IF NOT EXISTS public.bi_agent_prompts (
  id text PRIMARY KEY,
  file_name text NOT NULL UNIQUE,
  label text NOT NULL,
  body text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.bi_agent_prompts (id, file_name, label, body)
VALUES
  ('static', 'static.txt', 'Prompt principal (phase analyse)', ''),
  ('html-render', 'html-render.txt', 'Rendu HTML (phase 2)', ''),
  ('mode-quick', 'mode-quick.txt', 'Mode réponse rapide', ''),
  ('formule-kpi', 'formule-kpi.txt', 'Annexe formules KPI', '')
ON CONFLICT (id) DO NOTHING;

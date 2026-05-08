-- Paramétrage LLM runtime (provider / model / api_key) côté base applicative
-- node scripts/db-exec.cjs migrations/20260508142000_bi_llm_settings.sql

CREATE TABLE IF NOT EXISTS public.bi_llm_settings (
  id boolean PRIMARY KEY DEFAULT true,
  provider varchar(20) NOT NULL DEFAULT 'gemini',
  model varchar(120) NOT NULL DEFAULT 'gemini-2.5-flash',
  api_key text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_llm_settings_singleton_chk CHECK (id = true),
  CONSTRAINT bi_llm_settings_provider_chk CHECK (provider IN ('gemini', 'gpt', 'claude'))
);

INSERT INTO public.bi_llm_settings (id, provider, model, api_key)
VALUES (true, 'gemini', 'gemini-2.5-flash', NULL)
ON CONFLICT (id) DO NOTHING;


-- Historique d’affichage (hors n8n_chat_histories_v6 réservé à l’agent)
-- + clé courte affichée au front
-- node scripts/db-exec.cjs migrations/20260624140000_bi_conversation_ui.sql

CREATE TABLE IF NOT EXISTS public.bi_conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.bi_conversations (id) ON DELETE CASCADE,
  role varchar(20) NOT NULL,
  body_text text,
  body_html text,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_conversation_messages_role_chk
    CHECK (role IN ('user', 'assistant'))
);

CREATE INDEX IF NOT EXISTS idx_bi_conversation_messages_conv_created
  ON public.bi_conversation_messages (conversation_id, created_at);

ALTER TABLE public.bi_conversations
  ADD COLUMN IF NOT EXISTS display_key varchar(16);

UPDATE public.bi_conversations
SET display_key = lower(substr(replace(id::text, '-', ''), 1, 12))
WHERE display_key IS NULL;

ALTER TABLE public.bi_conversations
  ALTER COLUMN display_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bi_conversations_display_key_uniq
  ON public.bi_conversations (display_key);

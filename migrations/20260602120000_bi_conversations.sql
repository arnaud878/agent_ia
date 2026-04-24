-- Conversations par utilisateur (métadonnées) — session_id des messages = id (uuid)
-- node scripts/db-exec.cjs migrations/20260602120000_bi_conversations.sql

CREATE TABLE IF NOT EXISTS public.bi_conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users (id) ON DELETE CASCADE,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_conversations_user_updated
  ON public.bi_conversations (user_id, updated_at DESC);

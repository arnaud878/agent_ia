CREATE TABLE IF NOT EXISTS public.bi_conversation_attachments (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.bi_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  mime_type varchar(255) NOT NULL,
  size_bytes integer NOT NULL,
  storage_path text NOT NULL,
  extracted_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_conversation_attachments_conv_created
  ON public.bi_conversation_attachments (conversation_id, created_at);

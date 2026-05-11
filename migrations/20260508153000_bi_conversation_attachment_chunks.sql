CREATE TABLE IF NOT EXISTS public.bi_conversation_attachment_chunks (
  id uuid PRIMARY KEY,
  attachment_id uuid NOT NULL REFERENCES public.bi_conversation_attachments(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bi_conversation_attachment_chunks_attachment
  ON public.bi_conversation_attachment_chunks (attachment_id, chunk_index);

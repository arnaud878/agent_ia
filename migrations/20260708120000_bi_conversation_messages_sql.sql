-- Ajout des colonnes requete_sql / resultat_sql pour affichage admin
-- node scripts/db-exec.cjs migrations/20260708120000_bi_conversation_messages_sql.sql

ALTER TABLE public.bi_conversation_messages
  ADD COLUMN IF NOT EXISTS requete_sql text,
  ADD COLUMN IF NOT EXISTS resultat_sql text;

-- Rôles, utilisateurs, tables autorisées par rôle
-- node scripts/db-exec.cjs migrations/20260601120000_auth_rbac.sql

CREATE TABLE IF NOT EXISTS public.app_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  slug varchar(100) NOT NULL UNIQUE,
  description text,
  access_all_tables boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.app_role_tables (
  role_id uuid NOT NULL REFERENCES public.app_roles (id) ON DELETE CASCADE,
  table_name varchar(100) NOT NULL,
  PRIMARY KEY (role_id, table_name)
);

CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(255) NOT NULL UNIQUE,
  password_hash varchar(255) NOT NULL,
  role_id uuid NOT NULL REFERENCES public.app_roles (id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_users_email_idx ON public.app_users (email);

-- Rôles de base
INSERT INTO public.app_roles (id, name, slug, description, access_all_tables)
SELECT 'a0000001-0000-4000-8000-000000000001', 'Administrateur', 'admin',
       'Accès à toutes les tables BI', true
WHERE NOT EXISTS (SELECT 1 FROM public.app_roles WHERE slug = 'admin');

INSERT INTO public.app_roles (id, name, slug, description, access_all_tables)
SELECT 'a0000001-0000-4000-8000-000000000002', 'Commercial', 'commercial',
       'Exemple : ventes carburant uniquement', false
WHERE NOT EXISTS (SELECT 1 FROM public.app_roles WHERE slug = 'commercial');

-- Rôle par défaut pour l’inscription publique (REGISTER_DEFAULT_ROLE_SLUG=user) : tables à assigner via /iam
INSERT INTO public.app_roles (id, name, slug, description, access_all_tables)
SELECT 'a0000001-0000-4000-8000-000000000003', 'Utilisateur', 'user',
       'Inscription : aucune table tant que l’admin n’en ajoute pas au rôle', false
WHERE NOT EXISTS (SELECT 1 FROM public.app_roles WHERE slug = 'user');

INSERT INTO public.app_role_tables (role_id, table_name)
SELECT 'a0000001-0000-4000-8000-000000000002', 'vente_carburant'
WHERE NOT EXISTS (
  SELECT 1 FROM public.app_role_tables
  WHERE role_id = 'a0000001-0000-4000-8000-000000000002'
    AND table_name = 'vente_carburant'
);

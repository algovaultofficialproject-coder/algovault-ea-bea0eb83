CREATE TABLE public.guard_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL,
  login text NOT NULL,
  server text NOT NULL,
  password_encrypted text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_check_at timestamptz,
  last_status text,
  events jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, login, server)
);
GRANT ALL ON public.guard_accounts TO service_role;
ALTER TABLE public.guard_accounts ENABLE ROW LEVEL SECURITY;
CREATE INDEX guard_accounts_enabled_idx ON public.guard_accounts (enabled, last_check_at);

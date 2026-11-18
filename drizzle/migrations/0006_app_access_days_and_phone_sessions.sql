ALTER TABLE public.activated_emails ADD COLUMN IF NOT EXISTS access_until timestamptz;
ALTER TABLE public.activated_emails ADD COLUMN IF NOT EXISTS session_id uuid;

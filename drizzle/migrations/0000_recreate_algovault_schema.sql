-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'admin')
$$;

CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  is_admin boolean NOT NULL DEFAULT false,
  approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read own profile or admin" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Update own profile or admin" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- is_admin mirrors user_roles; approved changes need an admin.
CREATE OR REPLACE FUNCTION public.protect_profile_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    NEW.is_admin := OLD.is_admin;
    NEW.email := OLD.email;
    IF NEW.approved IS DISTINCT FROM OLD.approved AND NOT public.has_role(auth.uid(), 'admin') THEN
      NEW.approved := OLD.approved;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER profiles_protect_flags BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_flags();

CREATE OR REPLACE FUNCTION public.sync_profile_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := COALESCE(NEW.user_id, OLD.user_id);
BEGIN
  UPDATE public.profiles SET is_admin = public.has_role(uid, 'admin') WHERE id = uid;
  RETURN NULL;
END $$;
CREATE TRIGGER user_roles_sync_admin AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_admin();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, lower(COALESCE(NEW.email, '')), NULLIF(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  -- The portal owner account is the administrator.
  IF lower(COALESCE(NEW.email, '')) = 'mtwentwabantwana@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Client email activation
CREATE TABLE public.activated_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  approved boolean NOT NULL DEFAULT true,
  reactivation_pending boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activated_emails TO authenticated;
GRANT ALL ON public.activated_emails TO service_role;
ALTER TABLE public.activated_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Mentors read activations" ON public.activated_emails FOR SELECT TO authenticated USING (true);
CREATE POLICY "Mentors add activations" ON public.activated_emails FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Mentors update activations" ON public.activated_emails FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Admins delete activations" ON public.activated_emails FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Server-only settings and keys
CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.bridge_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  key_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_api_keys TO service_role;
ALTER TABLE public.bridge_api_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.mtapi_keys (
  platform text PRIMARY KEY,
  api_key text NOT NULL,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.mtapi_keys TO service_role;
ALTER TABLE public.mtapi_keys ENABLE ROW LEVEL SECURITY;

-- Broker accounts and trades (server-only)
CREATE TABLE public.broker_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  broker text NOT NULL,
  platform text NOT NULL,
  account_number text NOT NULL,
  login text,
  server text,
  bridge_url text,
  api_key_encrypted text,
  password_encrypted text,
  balance numeric,
  equity numeric,
  currency text,
  leverage integer,
  status text NOT NULL DEFAULT 'pending',
  last_sync timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_email, account_number)
);
GRANT ALL ON public.broker_connections TO service_role;
ALTER TABLE public.broker_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.trade_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email text NOT NULL,
  broker_connection_id uuid,
  action text NOT NULL DEFAULT 'open',
  side text NOT NULL,
  symbol text NOT NULL,
  lot numeric,
  entry numeric,
  stop_loss numeric,
  take_profit numeric,
  ticket text,
  status text NOT NULL DEFAULT 'pending',
  message text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trade_executions_owner_idx ON public.trade_executions (owner_email, created_at DESC);
GRANT ALL ON public.trade_executions TO service_role;
ALTER TABLE public.trade_executions ENABLE ROW LEVEL SECURITY;

-- Bots and licences (server-only; public reads go through server functions)
CREATE TABLE public.ea_configs (
  code text PRIMARY KEY,
  owner_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ea_configs TO service_role;
ALTER TABLE public.ea_configs ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ea_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ea_id text NOT NULL,
  code text NOT NULL,
  owner_email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ea_licenses TO service_role;
ALTER TABLE public.ea_licenses ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.ea_symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ea_id text NOT NULL,
  symbol text NOT NULL,
  lot_size numeric NOT NULL DEFAULT 0.01,
  action text NOT NULL DEFAULT 'BUY/SELL',
  platform text NOT NULL DEFAULT 'MT5',
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.ea_symbols TO service_role;
ALTER TABLE public.ea_symbols ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.portal_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  user_name text NOT NULL DEFAULT '',
  duration text NOT NULL DEFAULT '',
  ea_name text NOT NULL,
  ea_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_by uuid,
  active boolean NOT NULL DEFAULT true,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.portal_licenses TO service_role;
ALTER TABLE public.portal_licenses ENABLE ROW LEVEL SECURITY;

-- Manual signals: mentors manage their own; bots pull via server routes
CREATE TABLE public.manual_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  magic bigint NOT NULL,
  symbol text NOT NULL,
  side text NOT NULL,
  lot numeric NOT NULL DEFAULT 0.01,
  stop_loss numeric,
  take_profit numeric,
  comment text,
  consumed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX manual_signals_magic_idx ON public.manual_signals (magic, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_signals TO authenticated;
GRANT ALL ON public.manual_signals TO service_role;
ALTER TABLE public.manual_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read signals" ON public.manual_signals FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owners create signals" ON public.manual_signals FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners update signals" ON public.manual_signals FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners delete signals" ON public.manual_signals FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.pull_bot_signals(p_magic bigint)
RETURNS TABLE (id uuid, symbol text, side text, lot numeric, stop_loss numeric, take_profit numeric, comment text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.manual_signals m SET consumed_at = now()
  WHERE m.id IN (
    SELECT s.id FROM public.manual_signals s
    WHERE s.magic = p_magic AND s.consumed_at IS NULL AND s.created_at > now() - interval '5 minutes'
    ORDER BY s.created_at LIMIT 10 FOR UPDATE SKIP LOCKED
  )
  RETURNING m.id, m.symbol, m.side, m.lot, m.stop_loss, m.take_profit, m.comment, m.created_at;
END $$;
REVOKE ALL ON FUNCTION public.pull_bot_signals(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pull_bot_signals(bigint) TO anon, authenticated, service_role;

-- Payments (server-only)
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_payment_id text NOT NULL UNIQUE,
  pf_payment_id text,
  user_email text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZAR',
  purpose text NOT NULL DEFAULT 'app_access',
  status text NOT NULL DEFAULT 'pending',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZAR',
  bank_reference text,
  status text NOT NULL DEFAULT 'pending',
  pf_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.payouts TO service_role;
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.whop_checkouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  mentor_id text NOT NULL DEFAULT '',
  token_hash text NOT NULL UNIQUE,
  checkout_id text,
  membership_id text,
  payment_id text,
  status text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.whop_checkouts TO service_role;
ALTER TABLE public.whop_checkouts ENABLE ROW LEVEL SECURITY;

-- Mentor workspace
CREATE TABLE public.portal_state (
  user_id uuid PRIMARY KEY,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.portal_state TO authenticated;
GRANT ALL ON public.portal_state TO service_role;
ALTER TABLE public.portal_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read workspace" ON public.portal_state FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Owners create workspace" ON public.portal_state FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Owners update workspace" ON public.portal_state FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- One mentor bot; existing larger workspaces may shrink or edit, never grow.
CREATE OR REPLACE FUNCTION public.validate_mentor_bots()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  new_eas jsonb := COALESCE(NEW.data->'eas', '[]'::jsonb);
  old_eas jsonb := CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.data->'eas', '[]'::jsonb) ELSE '[]'::jsonb END;
BEGIN
  IF jsonb_typeof(new_eas) <> 'array' THEN
    RAISE EXCEPTION 'Invalid bot list.';
  END IF;
  IF jsonb_array_length(new_eas) <= 1 THEN RETURN NEW; END IF;
  IF jsonb_typeof(old_eas) <> 'array'
     OR jsonb_array_length(new_eas) > jsonb_array_length(old_eas)
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(new_eas) n
       WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(old_eas) o WHERE o->>'id' = n->>'id')
     ) THEN
    RAISE EXCEPTION 'You can only have one bot. Delete your current bot before adding another.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER portal_state_bot_limit BEFORE INSERT OR UPDATE ON public.portal_state
  FOR EACH ROW EXECUTE FUNCTION public.validate_mentor_bots();

-- Live signals feed shown in the client app
CREATE TABLE public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  action text NOT NULL,
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,
  lot_size numeric,
  status text NOT NULL DEFAULT 'new',
  broker text,
  account_number text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.signals TO anon, authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signals are public" ON public.signals FOR SELECT TO anon, authenticated USING (true);

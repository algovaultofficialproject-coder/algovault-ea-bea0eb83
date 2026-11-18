ALTER TABLE public.profiles ALTER COLUMN approved SET DEFAULT true;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- New mentors are approved automatically on registration.
  INSERT INTO public.profiles (id, email, full_name, approved)
  VALUES (NEW.id, lower(COALESCE(NEW.email, '')), NULLIF(NEW.raw_user_meta_data->>'full_name', ''), true)
  ON CONFLICT (id) DO NOTHING;
  IF lower(COALESCE(NEW.email, '')) = 'mtwentwabantwana@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $function$;

UPDATE public.profiles SET approved = true WHERE approved = false;

CREATE OR REPLACE FUNCTION public.generate_mentor_code()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE candidate text;
BEGIN
  LOOP
    candidate := (10000 + floor(random() * 90000))::int::text;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE mentor_code = candidate);
  END LOOP;
  RETURN candidate;
END $$;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS mentor_code text;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.profiles WHERE mentor_code IS NULL LOOP
    UPDATE public.profiles SET mentor_code = public.generate_mentor_code() WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.profiles ALTER COLUMN mentor_code SET DEFAULT public.generate_mentor_code();
ALTER TABLE public.profiles ALTER COLUMN mentor_code SET NOT NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_mentor_code_key UNIQUE (mentor_code);

REVOKE EXECUTE ON FUNCTION public.generate_mentor_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_mentor_code() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_profile_flags()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'authenticated' THEN
    NEW.is_admin := OLD.is_admin;
    NEW.email := OLD.email;
    NEW.mentor_code := OLD.mentor_code;
    IF NEW.approved IS DISTINCT FROM OLD.approved AND NOT public.has_role(auth.uid(), 'admin') THEN
      NEW.approved := OLD.approved;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE public.promo_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  bot_name text NOT NULL CHECK (char_length(bot_name) BETWEEN 1 AND 80),
  headline text NOT NULL DEFAULT '' CHECK (char_length(headline) <= 140),
  tagline text NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 200),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 3000),
  features text[] NOT NULL DEFAULT '{}' CHECK (cardinality(features) <= 8),
  price_text text NOT NULL DEFAULT '' CHECK (char_length(price_text) <= 80),
  whatsapp text NOT NULL DEFAULT '' CHECK (char_length(whatsapp) <= 32),
  telegram text NOT NULL DEFAULT '' CHECK (char_length(telegram) <= 64),
  cta_label text NOT NULL DEFAULT 'Get this bot' CHECK (char_length(cta_label) <= 40),
  image text CHECK (image IS NULL OR char_length(image) <= 600000),
  accent text NOT NULL DEFAULT 'azure' CHECK (accent IN ('azure','emerald','gold','crimson','violet')),
  published boolean NOT NULL DEFAULT false,
  views integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promo_sites_user_idx ON public.promo_sites(user_id);

GRANT SELECT ON public.promo_sites TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.promo_sites TO authenticated;
GRANT ALL ON public.promo_sites TO service_role;
ALTER TABLE public.promo_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published promo sites" ON public.promo_sites
  FOR SELECT TO anon, authenticated USING (published = true);
CREATE POLICY "Mentors view own promo sites" ON public.promo_sites
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Mentors create own promo sites" ON public.promo_sites
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Mentors update own promo sites" ON public.promo_sites
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Mentors delete own promo sites" ON public.promo_sites
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.protect_promo_site()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.role() = 'authenticated' THEN
    NEW.views := OLD.views;
    NEW.user_id := OLD.user_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER promo_sites_protect BEFORE UPDATE ON public.promo_sites
  FOR EACH ROW EXECUTE FUNCTION public.protect_promo_site();

CREATE TABLE public.promo_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.promo_sites(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  contact text NOT NULL CHECK (char_length(contact) BETWEEN 3 AND 120),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promo_leads_owner_idx ON public.promo_leads(owner_id, created_at DESC);

GRANT SELECT, DELETE ON public.promo_leads TO authenticated;
GRANT ALL ON public.promo_leads TO service_role;
ALTER TABLE public.promo_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Mentors view own leads" ON public.promo_leads
  FOR SELECT TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY "Mentors delete own leads" ON public.promo_leads
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE OR REPLACE FUNCTION public.bump_promo_view(_slug text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.promo_sites SET views = views + 1 WHERE slug = _slug AND published = true;
$$;

CREATE OR REPLACE FUNCTION public.submit_promo_lead(_slug text, _name text, _contact text, _message text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record;
BEGIN
  SELECT id, user_id INTO s FROM public.promo_sites WHERE slug = _slug AND published = true;
  IF s.id IS NULL THEN RETURN false; END IF;
  -- Simple flood guard per site.
  IF (SELECT count(*) FROM public.promo_leads WHERE site_id = s.id AND created_at > now() - interval '10 minutes') >= 30 THEN
    RETURN false;
  END IF;
  INSERT INTO public.promo_leads (site_id, owner_id, name, contact, message)
  VALUES (s.id, s.user_id, btrim(_name), btrim(_contact), btrim(COALESCE(_message, '')));
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.bump_promo_view(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_promo_lead(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_promo_view(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_promo_lead(text, text, text, text) TO anon, authenticated, service_role;

COMMENT ON TABLE public.portal_state IS 'Mentor workspace: one row per mentor account.';

ALTER TABLE public.promo_sites
  ADD COLUMN old_price text NOT NULL DEFAULT '' CHECK (char_length(old_price) <= 80),
  ADD COLUMN offer_percent integer NOT NULL DEFAULT 0 CHECK (offer_percent BETWEEN 0 AND 95),
  ADD COLUMN offer_ends_at timestamptz,
  ADD COLUMN stat_text text NOT NULL DEFAULT '' CHECK (char_length(stat_text) <= 40);

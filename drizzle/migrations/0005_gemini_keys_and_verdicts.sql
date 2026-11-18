CREATE TABLE public.gemini_keys (
  slot smallint PRIMARY KEY CHECK (slot IN (1, 2)),
  api_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
GRANT ALL ON public.gemini_keys TO service_role;
REVOKE ALL ON public.gemini_keys FROM anon, authenticated;
ALTER TABLE public.gemini_keys ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.gemini_verdicts (
  symbol text NOT NULL,
  bar_time bigint NOT NULL,
  side text NOT NULL CHECK (side IN ('BUY', 'SELL', 'WAIT')),
  confidence integer NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, bar_time)
);
GRANT ALL ON public.gemini_verdicts TO service_role;
REVOKE ALL ON public.gemini_verdicts FROM anon, authenticated;
ALTER TABLE public.gemini_verdicts ENABLE ROW LEVEL SECURITY;

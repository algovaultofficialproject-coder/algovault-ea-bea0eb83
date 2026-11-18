CREATE TABLE public.chart_scan_usage (
  email text NOT NULL,
  day date NOT NULL,
  used integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, day)
);
GRANT ALL ON public.chart_scan_usage TO service_role;
REVOKE ALL ON public.chart_scan_usage FROM anon, authenticated;
ALTER TABLE public.chart_scan_usage ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_chart_scan(_email text, _day date, _limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.chart_scan_usage (email, day, used)
  VALUES (lower(trim(_email)), _day, 1)
  ON CONFLICT (email, day) DO UPDATE
    SET used = chart_scan_usage.used + 1, updated_at = now()
    WHERE chart_scan_usage.used < _limit
  RETURNING used INTO n;
  RETURN COALESCE(n, -1);
END;
$$;
REVOKE ALL ON FUNCTION public.consume_chart_scan(text, date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_chart_scan(text, date, integer) TO service_role;

/*
# Fix save_lease date casts

1. Changes
- `public.save_lease`: `risk_free_rate_date` and `rate_date` are now cast to `date`
  in both the UPDATE and INSERT paths. Before this, every lease create/edit failed with
  "column risk_free_rate_date is of type date but expression is of type text".
2. Security
- No change to checks or grants. EXECUTE stays limited to `authenticated`.
*/
DO $mig$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.save_lease(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  d := replace(d, $r$NULLIF(p_lease->>'risk_free_rate_date', ''),$r$, $r$NULLIF(p_lease->>'risk_free_rate_date', '')::date,$r$);
  d := replace(d, $r$NULLIF(p_lease->>'rate_date', ''),$r$, $r$NULLIF(p_lease->>'rate_date', '')::date,$r$);
  EXECUTE d;
END
$mig$;

REVOKE ALL ON FUNCTION public.save_lease(jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_lease(jsonb, jsonb, jsonb, jsonb) TO authenticated;
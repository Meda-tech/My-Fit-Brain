-- ==============================================================================
-- Gap-free report IDs for paid attempts.
--
-- Before: the server took a report number (next_report_id) and then inserted the attempt in a second
-- call. When the checkout callback and the Razorpay webhook created the attempt for the same payment
-- at the same moment, the unique payment_ref index stopped the second insert, but its report number
-- had already been committed: the series skipped a number.
--
-- Now: create_paid_attempt() does everything in one transaction:
--   1. a transaction-level advisory lock on the payment reference serialises callers for that payment;
--   2. if an attempt already exists for the payment, it is returned and no number is taken;
--   3. otherwise the next report number is taken and the attempt inserted.
-- The counter row update and the insert commit or roll back together, so a number is used only by an
-- attempt that exists. The unique index on attempts.payment_ref stays as the last guard.
--
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/08b-paid-attempt-verify.sql.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.create_paid_attempt(
  p_client_id uuid,
  p_test_code text,
  p_version_id uuid,
  p_payment_ref text,
  p_paid_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_attempt public.attempts;
BEGIN
  IF p_payment_ref IS NULL OR length(p_payment_ref) = 0 THEN
    RAISE EXCEPTION 'A paid attempt needs the payment reference.';
  END IF;

  -- 1. One caller at a time per payment (released at commit or rollback).
  PERFORM pg_advisory_xact_lock(hashtextextended('attempt:' || p_payment_ref, 0));

  -- 2. Already created for this payment: return it, take no number.
  SELECT * INTO v_attempt FROM public.attempts
  WHERE payment_mode = 'live' AND payment_ref = p_payment_ref;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(v_attempt));
  END IF;

  -- 3. New: the number and the row in the same transaction.
  INSERT INTO public.attempts (
    report_id, client_id, test_code, version_id, kind, status, payment_mode, payment_ref, paid_at
  ) VALUES (
    public.next_report_id(p_test_code), p_client_id, p_test_code, p_version_id, 'initial', 'paid', 'live',
    p_payment_ref, p_paid_at
  )
  RETURNING * INTO v_attempt;

  RETURN jsonb_build_object('created', true, 'attempt', to_jsonb(v_attempt));
END;
$$;
COMMENT ON FUNCTION public.create_paid_attempt(uuid, text, uuid, text, timestamptz) IS
  'Creates (or returns) the one attempt for a live payment; the report number is taken in the same transaction';

-- Only the server (service role) creates paid attempts.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.create_paid_attempt(uuid, text, uuid, text, timestamptz) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.create_paid_attempt(uuid, text, uuid, text, timestamptz) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.create_paid_attempt(uuid, text, uuid, text, timestamptz) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.create_paid_attempt(uuid, text, uuid, text, timestamptz) TO service_role;
  END IF;
END;
$$;

COMMIT;

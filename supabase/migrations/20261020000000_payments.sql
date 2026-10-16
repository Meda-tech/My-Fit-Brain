-- ==============================================================================
-- Payments (Razorpay). One row per checkout; a paid payment creates exactly one attempt.
--
--   payments         order created on the server (amount fixed by the server, never by the browser),
--                    marked paid only after the server verifies the payment with Razorpay
--                    (checkout signature + payment fetch, or a signed webhook)
--   payment_events   webhook deliveries already processed (Razorpay retries; each event runs once)
--   attempts         a live payment's Razorpay payment ID is unique (one attempt per payment)
--
-- Writes go through the service role only. Clients read their own payments; active staff read all.
-- Secrets (key secret, webhook secret) live in env vars, never here.
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/08-payments-verify.sql.
-- ==============================================================================

BEGIN;

-- 1. PAYMENTS
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id),
  test_code text NOT NULL REFERENCES public.qb_tests(code),
  provider text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay')),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  provider_order_id text NOT NULL UNIQUE,
  provider_payment_id text UNIQUE,
  method text,
  failure_code text,
  failure_reason text,
  attempt_id uuid UNIQUE REFERENCES public.attempts(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_paid_has_payment CHECK (status <> 'paid' OR (provider_payment_id IS NOT NULL AND paid_at IS NOT NULL))
);
COMMENT ON TABLE public.payments IS 'Razorpay checkouts; status paid only after server-side verification';
CREATE INDEX IF NOT EXISTS idx_payments_client ON public.payments (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_attempt ON public.payments (attempt_id);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON public.payments;
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- A payment's identity and amount never change; a paid payment stays paid; no deletes.
CREATE OR REPLACE FUNCTION public.payment_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments are never deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.test_code IS DISTINCT FROM OLD.test_code
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id THEN
    RAISE EXCEPTION 'A payment''s client, test, amount and order never change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'paid' AND (
       NEW.status <> 'paid'
       OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR (OLD.attempt_id IS NOT NULL AND NEW.attempt_id IS DISTINCT FROM OLD.attempt_id)) THEN
    RAISE EXCEPTION 'A paid payment cannot change.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_payments_guard ON public.payments;
CREATE TRIGGER trg_payments_guard BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payment_guard();

-- 2. WEBHOOK EVENTS (dedupe by Razorpay's x-razorpay-event-id)
CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id text NOT NULL UNIQUE,
  event text NOT NULL,
  provider_order_id text,
  provider_payment_id text,
  received_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.payment_events IS 'Processed Razorpay webhook events (ids only, no payloads)';

-- 3. ONE ATTEMPT PER LIVE PAYMENT
CREATE UNIQUE INDEX IF NOT EXISTS uq_attempts_live_payment_ref
  ON public.attempts (payment_ref) WHERE payment_mode = 'live' AND payment_ref IS NOT NULL;

-- 4. ROW LEVEL SECURITY
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated USING (
  public.is_active_staff()
  OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = payments.client_id AND c.auth_user_id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS payment_events_select ON public.payment_events;
CREATE POLICY payment_events_select ON public.payment_events FOR SELECT TO authenticated
  USING (public.is_super_admin());

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.payment_guard() FROM PUBLIC;
END;
$$;

COMMIT;

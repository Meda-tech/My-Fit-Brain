-- ==============================================================================
-- Pay first, log in later.
--
-- A visitor pays on the public page /pay/<questionnaire code> (e.g. /pay/IA) with only a phone
-- number. The payment is a "purchase" owned by that phone. When someone logs in with that phone
-- (OTP), every paid, unclaimed purchase for the phone is linked to their client record. The
-- assessment (and its report ID) is created only when the client presses Start.
--
-- This file only ADDS. It deletes, drops or truncates nothing. It does:
--   1. payments                  + phone (E.164), claimed_at, refund_status, ip_hash;
--                                client_id may be empty until the purchase is claimed.
--                                Existing payments get their client's phone and count as claimed
--                                (an UPDATE that fills the new columns; no row is removed)
--   2. payment_guard()           replaced: owner (phone / client) may change only before Start
--   3. payment_moves             a log of "Move purchase to another number" (staff action)
--   4. RLS                       payment_moves: super admins and coordinators read; writes only by
--                                the server. The payments policies stay as they are.
--
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/13-pay-first-verify.sql.
-- ==============================================================================

BEGIN;

-- 1. PAYMENTS BECOME PURCHASES OWNED BY A PHONE
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS ip_hash text;
ALTER TABLE public.payments ALTER COLUMN client_id DROP NOT NULL;

COMMENT ON COLUMN public.payments.phone IS 'E.164 phone the purchase belongs to (typed on the pay page, or the signed-in client''s)';
COMMENT ON COLUMN public.payments.client_id IS 'Empty until a client logs in with the phone (claim)';
COMMENT ON COLUMN public.payments.claimed_at IS 'When the purchase was linked to the client';
COMMENT ON COLUMN public.payments.refund_status IS 'needed (e.g. under 18 at registration) → refunded (staff, after refunding in Razorpay)';
COMMENT ON COLUMN public.payments.ip_hash IS 'Keyed hash of the buyer''s IP, only for rate limiting order creation';

-- Existing payments: the client's phone (normalised to +91…), already claimed when created.
UPDATE public.payments p
SET phone = CASE
              WHEN c.phone ~ '^\d{10}$' THEN '+91' || c.phone
              WHEN c.phone ~ '^91\d{10}$' THEN '+' || c.phone
              ELSE c.phone
            END,
    claimed_at = p.created_at
FROM public.clients c
WHERE c.id = p.client_id AND p.phone IS NULL;

ALTER TABLE public.payments ALTER COLUMN phone SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_phone_e164') THEN
    -- NOT VALID: checked for every new or changed row; older rows are not re-checked.
    ALTER TABLE public.payments ADD CONSTRAINT payments_phone_e164 CHECK (phone ~ '^\+[1-9][0-9]{9,14}$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_refund_status') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_refund_status
      CHECK (refund_status IS NULL OR (refund_status IN ('needed', 'refunded') AND status = 'paid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_claimed') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_claimed CHECK ((client_id IS NULL) = (claimed_at IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_attempt_has_client') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_attempt_has_client CHECK (attempt_id IS NULL OR client_id IS NOT NULL);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payments_phone ON public.payments (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_ip ON public.payments (ip_hash, created_at DESC) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_unclaimed ON public.payments (phone) WHERE client_id IS NULL AND status = 'paid';

-- 2. GUARD: identity and amount never change; a paid payment stays paid; the owner (phone, client)
-- may change only until the assessment is started; a refunded purchase is never started; no deletes.
CREATE OR REPLACE FUNCTION public.payment_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments are never deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.test_code IS DISTINCT FROM OLD.test_code
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id THEN
    RAISE EXCEPTION 'A payment''s test, amount and order never change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.attempt_id IS NOT NULL AND (
       NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.phone IS DISTINCT FROM OLD.phone) THEN
    RAISE EXCEPTION 'A started purchase keeps its owner and assessment.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'paid' AND (
       NEW.status <> 'paid'
       OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'A paid payment cannot change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.refund_status = 'refunded' AND NEW.refund_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'A refunded purchase stays refunded.' USING ERRCODE = '42501';
  END IF;
  IF OLD.attempt_id IS NULL AND NEW.attempt_id IS NOT NULL AND NEW.refund_status IS NOT NULL THEN
    RAISE EXCEPTION 'A purchase marked for refund cannot be started.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. MOVES (staff: "Move purchase to another number")
CREATE TABLE IF NOT EXISTS public.payment_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES public.payments(id),
  from_phone text NOT NULL,
  to_phone text NOT NULL CHECK (to_phone ~ '^\+[1-9][0-9]{9,14}$'),
  from_client_id uuid REFERENCES public.clients(id),
  moved_by uuid NOT NULL REFERENCES public.profiles(id),
  moved_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.payment_moves IS 'Purchases moved to another phone number by staff (who, when, from, to)';
CREATE INDEX IF NOT EXISTS idx_payment_moves_payment ON public.payment_moves (payment_id, moved_at DESC);

-- 4. ROW LEVEL SECURITY (writes only through the service role)
ALTER TABLE public.payment_moves ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_moves_select ON public.payment_moves;
CREATE POLICY payment_moves_select ON public.payment_moves FOR SELECT TO authenticated
  USING (public.can_view_payments());

COMMIT;

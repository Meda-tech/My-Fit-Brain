-- Step 1 adjustment (owner, 2026-11-20): unpaid tries are payment attempts, not purchases; moving a
-- coordinator's clients; no "Make inactive" while a coordinator still has clients.
-- Run after 20261120100000_purchases.sql.
--
-- REMOVES NOTHING. No DELETE, no DROP, no TRUNCATE. The payments table is not changed. Rows of
-- purchases / purchase_payments / client_coordinators are only added or updated.
--
-- In plain words:
--   1. A try that is not paid is a PAYMENT ATTEMPT: a purchases row with status not_paid. It keeps its
--      coordinator. It is not a purchase and the Purchases screen does not show it.
--      One open attempt per phone and assessment: a new try for the same phone and assessment joins it.
--   2. When that phone pays the same assessment (Razorpay or manual), the open attempt becomes the purchase:
--      the same row turns Paid, with the same coordinator. With no open attempt, a payment starts its own row.
--   3. One paid payment per purchase: a second payment that is paid inside the same purchase (for example a
--      checkout that was still open when a manual payment was added) becomes its own Paid purchase.
--   4. payment_attempts: a read-only view of the attempts (first and last try, failed or not completed, open
--      or closed), for the coordinator's Payment call in step 2. An older attempt that a later try or purchase
--      of the same phone and assessment replaced is closed (closed_at), never removed.
--   5. move_coordinator_clients(from, to, by): moves all clients (phones) of one coordinator, and their
--      purchases and attempts, to another active coordinator; logged in coordinator_client_moves.
--   6. A coordinator who still has clients cannot be made inactive: "Move their clients first."
--      The round robin for a phone whose coordinator is not active stays only as a safety fallback.
--
-- Checks: docs/tasks/21-purchases-verify.sql and docs/tasks/21b-payment-attempts-verify.sql

BEGIN;

-- 1. Payment attempts ---------------------------------------------------------------------------------

ALTER TABLE public.purchases ADD COLUMN closed_at timestamptz;
COMMENT ON COLUMN public.purchases.closed_at IS 'Payment attempts only: when a later try or purchase of the same phone and assessment replaced this attempt. Empty = open.';
COMMENT ON TABLE public.purchases IS 'A purchase (status paid, refunded or cancelled) or a payment attempt (status not_paid: tried on the pay page, not paid). When the phone pays the same assessment, its open attempt becomes the purchase (same row, same coordinator). The phone, client and amount follow its payment.';
CREATE INDEX purchases_open_attempt_idx ON public.purchases (phone, test_code) WHERE status = 'not_paid' AND closed_at IS NULL;
CREATE INDEX purchases_paid_idx ON public.purchases (paid_at DESC) WHERE status <> 'not_paid';

-- A new row (attempt, until a payment in it is paid) with the five journey stages, for one payment.
CREATE OR REPLACE FUNCTION public.purchase_new(p_payment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.payments;
  v_id uuid;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = p_payment;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.purchases (kind, test_code, phone, client_id, amount_paise, status, source, coordinator_id, created_at)
  VALUES ('assessment', p.test_code, p.phone, p.client_id, p.amount_paise, 'not_paid',
          CASE WHEN p.provider = 'offline' THEN 'manual' ELSE 'pay_page' END,
          public.client_coordinator(p.phone), p.created_at)
  RETURNING id INTO v_id;
  INSERT INTO public.purchase_stages (purchase_id, stage, position) VALUES
    (v_id, 'payment', 1), (v_id, 'assessment', 2), (v_id, 'presentation_booking', 3),
    (v_id, 'report_presentation', 4), (v_id, 'package_call', 5);
  RETURN v_id;
END;
$$;

-- Puts one payment into a row (once) and returns the row. Every payment, paid or not, Razorpay or manual,
-- joins the open payment attempt of the same phone and assessment; without one it starts a new row.
CREATE OR REPLACE FUNCTION public.purchase_for_payment(p_payment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.payments;
  v_id uuid;
BEGIN
  SELECT purchase_id INTO v_id FROM public.purchase_payments WHERE payment_id = p_payment;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT * INTO p FROM public.payments WHERE id = p_payment;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Two tries of one phone and assessment at the same moment must not open two attempts.
  PERFORM pg_advisory_xact_lock(hashtextextended('payment-attempt:' || p.phone || ':' || p.test_code, 0));

  SELECT pu.id INTO v_id FROM public.purchases pu
  WHERE pu.phone = p.phone AND pu.test_code = p.test_code AND pu.kind = 'assessment'
    AND pu.status = 'not_paid' AND pu.closed_at IS NULL
  ORDER BY pu.created_at DESC, pu.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    v_id := public.purchase_new(p.id);
  END IF;

  INSERT INTO public.purchase_payments (payment_id, purchase_id, accounts_check)
  VALUES (p.id, v_id, CASE WHEN p.provider = 'offline' THEN 'pending' END);
  PERFORM public.purchase_refresh(v_id);
  RETURN v_id;
END;
$$;

-- One paid payment per purchase. When this payment is paid and its purchase already had an earlier paid
-- payment, this one moves to a new Paid purchase of its own. Returns the payment's row.
CREATE OR REPLACE FUNCTION public.purchase_one_paid(p_payment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old uuid;
  v_first uuid;
  v_new uuid;
BEGIN
  SELECT pp.purchase_id INTO v_old
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.payment_id = p_payment AND p.status = 'paid';
  IF v_old IS NULL THEN
    RETURN (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = p_payment);
  END IF;

  SELECT p.id INTO v_first
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.purchase_id = v_old AND p.status = 'paid'
  ORDER BY coalesce(p.paid_at, p.created_at), p.created_at, p.id
  LIMIT 1;
  IF v_first = p_payment THEN
    RETURN v_old;
  END IF;

  v_new := public.purchase_new(p_payment);
  UPDATE public.purchase_payments SET purchase_id = v_new, linked_at = now() WHERE payment_id = p_payment;
  PERFORM public.purchase_refresh(v_old);
  PERFORM public.purchase_refresh(v_new);
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.payments_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  BEGIN
    v_id := public.purchase_for_payment(NEW.id);   -- new payment: its row; existing: the one it has
    v_id := coalesce(public.purchase_one_paid(NEW.id), v_id);
    IF TG_OP = 'UPDATE' THEN
      PERFORM public.purchase_refresh(v_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Purchase for payment % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- The payment attempts, for reading (the coordinator's Payment call in step 2). Same access as purchases.
CREATE VIEW public.payment_attempts WITH (security_invoker = true) AS
SELECT pu.id, pu.test_code, pu.phone, pu.client_id, pu.amount_paise, pu.coordinator_id,
       pu.created_at AS first_tried_at,
       last_try.created_at AS last_tried_at,
       CASE WHEN last_try.status = 'failed' THEN 'failed' ELSE 'not_completed' END AS last_try_status,
       pu.closed_at,
       pu.closed_at IS NULL AS is_open
FROM public.purchases pu
LEFT JOIN LATERAL (
  SELECT p.created_at, p.status
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.purchase_id = pu.id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) last_try ON true
WHERE pu.status = 'not_paid';
COMMENT ON VIEW public.payment_attempts IS 'Tries on the pay page that are not paid. last_try_status: failed or not_completed (checkout not finished). is_open: not replaced by a later try or purchase of the same phone and assessment.';

-- 2. Moving a coordinator's clients -----------------------------------------------------------------

CREATE TABLE public.coordinator_client_moves (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_coordinator_id uuid NOT NULL REFERENCES public.profiles(id),
  to_coordinator_id   uuid NOT NULL REFERENCES public.profiles(id),
  clients_moved       integer NOT NULL,
  moved_by            uuid REFERENCES public.profiles(id),
  moved_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.coordinator_client_moves IS 'Each time a super admin moved all clients of one coordinator to another.';
ALTER TABLE public.coordinator_client_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY coordinator_client_moves_select ON public.coordinator_client_moves FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- Moves every client (phone) of p_from, with their purchases and payment attempts, to p_to. Returns how many
-- clients moved.
CREATE OR REPLACE FUNCTION public.move_coordinator_clients(p_from uuid, p_to uuid, p_by uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phones text[];
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'Choose another coordinator.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND role = 'coordinator' AND is_active) THEN
    RAISE EXCEPTION 'The new coordinator must be an active coordinator.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('coordinator-round-robin', 0));

  WITH moved AS (
    UPDATE public.client_coordinators SET coordinator_id = p_to, assigned_at = now()
    WHERE coordinator_id = p_from
    RETURNING phone
  )
  SELECT coalesce(array_agg(phone), '{}') INTO v_phones FROM moved;

  UPDATE public.purchases SET coordinator_id = p_to
  WHERE coordinator_id = p_from OR phone = ANY (v_phones);

  INSERT INTO public.coordinator_client_moves (from_coordinator_id, to_coordinator_id, clients_moved, moved_by)
  VALUES (p_from, p_to, cardinality(v_phones), p_by);
  RETURN cardinality(v_phones);
END;
$$;

-- 3. No "Make inactive" while a coordinator still has clients --------------------------------------

CREATE OR REPLACE FUNCTION public.profiles_keep_clients_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.is_active AND NOT NEW.is_active
     AND EXISTS (SELECT 1 FROM public.client_coordinators WHERE coordinator_id = OLD.id) THEN
    RAISE EXCEPTION 'Move their clients first.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_keep_clients BEFORE UPDATE OF is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_keep_clients_trigger();

-- 4. Who may call / read ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.purchase_new(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_one_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_coordinator_clients(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_keep_clients_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_coordinator_clients(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON public.payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_attempts TO authenticated, service_role;

-- 5. Existing rows (updates only) -------------------------------------------------------------------

-- One paid payment per purchase.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT pp.payment_id FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
           WHERE p.status = 'paid' ORDER BY coalesce(p.paid_at, p.created_at), p.id LOOP
    PERFORM public.purchase_one_paid(r.payment_id);
  END LOOP;
END;
$$;

-- An older attempt that a later try or purchase of the same phone and assessment replaced is closed.
UPDATE public.purchases pu
SET closed_at = (SELECT min(l.created_at) FROM public.purchases l
                 WHERE l.phone = pu.phone AND l.test_code = pu.test_code AND l.kind = pu.kind
                   AND (l.created_at, l.id) > (pu.created_at, pu.id))
WHERE pu.status = 'not_paid' AND pu.closed_at IS NULL
  AND EXISTS (SELECT 1 FROM public.purchases l
              WHERE l.phone = pu.phone AND l.test_code = pu.test_code AND l.kind = pu.kind
                AND (l.created_at, l.id) > (pu.created_at, pu.id));

COMMIT;

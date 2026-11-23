-- Repeat tries and payments, same phone + same assessment (owner, 2026-11-23).
-- Run after 20261122000000_payment_calls_go_live.sql.
--
-- REMOVES NO ROWS. No DELETE, no TRUNCATE, no table or column dropped. The payments table gets no new column; the
-- only change to its rows is the safety net below, which sets refund_status = 'needed' on a second payment.
-- Three allowed-values lists (CHECK rules) are replaced by WIDER ones (owner's standing permission, 2026-11-20):
--   purchases.closed_reason + 'not_needed' · calls.outcome + 'not_needed' · call_logs.event + 'not_needed'.
-- New column purchase_payments.extra_paid_at, new table purchase_blocked_tries, new functions; new bodies for
-- purchase_refresh(), purchase_for_payment(), purchase_one_paid() and payments_purchase_trigger().
--
-- In plain words. "Open purchase" = the LATEST row of that phone and assessment is a Paid purchase whose journey is
-- still running: no package paid for it, its Package call not closed as Not interested, not refunded or cancelled.
--   1. Latest row is an unpaid try → a new try or payment joins that same row (as before). Paid → that row is Paid.
--   2. Latest row is an OPEN purchase → no second payment:
--      - pay_page_try_blocked(): the pay page asks the database before it creates any Razorpay order. When the phone
--        has an open purchase, no order is made and the try is only a history line on that purchase ("Tried again –
--        blocked, already paid <date>", table purchase_blocked_tries). No new row, no Payment call.
--      - purchase_open_for(): the staff manual payment form (and Move to another number) refuse.
--      - Safety net only: a payment that still arrives paid (e.g. two tabs at the same moment) is kept on the open
--        purchase as history, marked "Refund needed" and starts no second journey (purchase_payments.extra_paid_at).
--        No payment is ever lost.
--   3. Latest row is FINISHED (package paid, Package call closed as Not interested, refunded, cancelled) → a new try
--      starts a new row with a normal Payment call; a new payment starts a new journey (retakes work).
--   4. Once, now: unpaid rows made while the phone already had an open purchase (a try after paying, e.g. Tarnjit
--      Singh on 22 Nov) move their tries onto that open purchase as history; the extra row and its open Payment call
--      close as "Not needed – client already paid on <date>". Rows are changed only.
--   5. Packages: no change.
--
-- Checks: docs/tasks/34-repeat-payments-verify.sql · behaviour test supabase/staging/staging-test-repeat-payments.sql

BEGIN;

-- 1. Wider allowed values ------------------------------------------------------------------------------------

ALTER TABLE public.purchases DROP CONSTRAINT purchases_closed_reason_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_closed_reason_check
  CHECK (closed_reason IN ('replaced', 'not_interested', 'not_needed'));
COMMENT ON COLUMN public.purchases.closed_reason IS 'Payment attempts only, with closed_at: replaced (a later try or purchase of the same phone and assessment), not_interested (from a Payment call), not_needed (the phone already had an open purchase of this assessment; its tries are history on that purchase).';

ALTER TABLE public.calls DROP CONSTRAINT calls_outcome_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended', 'before_go_live', 'booked', 'package_paid',
                     'not_needed'));

ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_event_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_event_check
  CHECK (event IN ('created', 'new_try', 'try_failed', 'paid', 'assessment_completed', 'ended', 'reopened',
                   'presentation_booked', 'booking_cancelled',
                   'package_paid', 'package_payment_failed', 'package_payment_not_completed', 'package_refund_needed',
                   'not_needed'));

-- 2. New column and table ------------------------------------------------------------------------------------

ALTER TABLE public.purchase_payments ADD COLUMN extra_paid_at timestamptz;
COMMENT ON COLUMN public.purchase_payments.extra_paid_at IS 'Safety net: a second paid payment that arrived while this purchase was already open (e.g. two tabs at once). Kept here as history, marked Refund needed; it starts no journey.';

CREATE TABLE public.purchase_blocked_tries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  uuid NOT NULL REFERENCES public.purchases(id),
  phone        text NOT NULL,
  at           timestamptz NOT NULL DEFAULT now(),
  signed_in    boolean NOT NULL,
  ip_hash      text
);
COMMENT ON TABLE public.purchase_blocked_tries IS 'Pay page tries refused because the phone already had an open purchase of that assessment ("Tried again – blocked, already paid <date>"). No Razorpay order was made. ip_hash: keyed hash, rate limit only. Never changed or removed.';
CREATE INDEX purchase_blocked_tries_purchase_idx ON public.purchase_blocked_tries (purchase_id, at);
CREATE INDEX purchase_blocked_tries_phone_idx ON public.purchase_blocked_tries (phone, at);
CREATE INDEX purchase_blocked_tries_ip_idx ON public.purchase_blocked_tries (ip_hash, at) WHERE ip_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.purchase_blocked_tries_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Blocked tries are never changed or removed.';
END;
$$;
CREATE TRIGGER purchase_blocked_tries_keep BEFORE UPDATE OR DELETE ON public.purchase_blocked_tries
  FOR EACH ROW EXECUTE FUNCTION public.purchase_blocked_tries_keep_trigger();

-- Whoever sees the purchase sees its blocked tries (super admins all, a coordinator their clients).
ALTER TABLE public.purchase_blocked_tries ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_blocked_tries_select ON public.purchase_blocked_tries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_blocked_tries.purchase_id));

-- 3. The latest row and the open purchase ---------------------------------------------------------------------

-- The latest row of a phone and assessment: an assessment purchase or an unpaid try. Rows closed as replaced or not
-- needed were superseded and are left out. All NULL when there is none.
CREATE OR REPLACE FUNCTION public.purchase_latest(p_phone text, p_test text)
RETURNS public.purchases LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pu.* FROM public.purchases pu
  WHERE pu.phone = p_phone AND pu.test_code = p_test AND pu.kind = 'assessment'
    AND pu.closed_reason IS DISTINCT FROM 'replaced' AND pu.closed_reason IS DISTINCT FROM 'not_needed'
  ORDER BY pu.created_at DESC, pu.id DESC
  LIMIT 1;
$$;

-- Paid and its journey still running: no package paid for it, its Package call not closed as Not interested.
-- (Refunded and cancelled purchases have another status.)
CREATE OR REPLACE FUNCTION public.purchase_is_open(p public.purchases)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id IS NOT NULL AND p.kind = 'assessment' AND p.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = p.id AND x.kind = 'package' AND x.status = 'paid')
    AND NOT EXISTS (SELECT 1 FROM public.calls c
                    WHERE c.purchase_id = p.id AND c.kind = 'package' AND c.status = 'closed' AND c.outcome = 'not_interested');
$$;

-- The open purchase of a phone and assessment (its latest row, when open), or no row.
CREATE OR REPLACE FUNCTION public.purchase_open_for(p_phone text, p_test text)
RETURNS TABLE (purchase_id uuid, paid_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.paid_at FROM public.purchase_latest(p_phone, p_test) l WHERE public.purchase_is_open(l);
$$;

-- The pay page, before any Razorpay order: true = the phone has an open purchase of this assessment, so no order is
-- made; the try is written as a history line on that purchase.
CREATE OR REPLACE FUNCTION public.pay_page_try_blocked(p_phone text, p_test text, p_signed_in boolean, p_ip_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_open uuid;
BEGIN
  SELECT o.purchase_id INTO v_open FROM public.purchase_open_for(p_phone, p_test) o;
  IF v_open IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.purchase_blocked_tries (purchase_id, phone, signed_in, ip_hash)
  VALUES (v_open, p_phone, coalesce(p_signed_in, false), p_ip_hash);
  RETURN true;
END;
$$;

-- An unpaid row that is not needed (the phone already paid): closed, and its open Payment call closed with the note
-- "Not needed – client already paid on <date>." Nothing else changes.
CREATE OR REPLACE FUNCTION public.purchase_close_not_needed(p_row uuid, p_paid_at timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_note text := 'Not needed – client already paid on '
                 || coalesce(to_char(p_paid_at AT TIME ZONE 'Asia/Kolkata', 'FMDD Mon YYYY'), 'an earlier date') || '.';
  v_call uuid;
BEGIN
  UPDATE public.purchases SET closed_at = now(), closed_reason = 'not_needed'
  WHERE id = p_row AND status = 'not_paid' AND (closed_at IS NULL OR closed_reason = 'not_interested');
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.calls SET status = 'closed', outcome = 'not_needed', closed_at = now(), closed_note = v_note
  WHERE purchase_id = p_row AND kind = 'payment' AND status = 'open'
  RETURNING id INTO v_call;
  IF v_call IS NOT NULL THEN
    INSERT INTO public.call_logs (call_id, entry, event, note) VALUES (v_call, 'event', 'not_needed', v_note);
  END IF;
END;
$$;

-- 4. Purchases from payments (new bodies) ---------------------------------------------------------------------

-- Same as 20261120100000, except that the payment speaking for the purchase is never an extra (safety net) payment.
CREATE OR REPLACE FUNCTION public.purchase_refresh(p_purchase uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  main public.payments;
  v_status text;
  v_coord uuid;
  v_completed timestamptz;
  v_open_set boolean := false;
  s record;
BEGIN
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- The payment that speaks for the purchase: the paid one (never an extra one), else the latest.
  SELECT p.* INTO main
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.purchase_id = p_purchase
  ORDER BY (p.status = 'paid' AND pp.extra_paid_at IS NULL) DESC, (p.status = 'paid') DESC, coalesce(p.paid_at, p.created_at) DESC
  LIMIT 1;
  IF main.id IS NULL THEN
    RETURN;
  END IF;

  v_status := CASE
    WHEN main.status = 'paid' AND main.refund_status = 'refunded' THEN 'refunded'
    WHEN main.status = 'paid' THEN 'paid'
    WHEN main.status = 'cancelled' THEN 'cancelled'
    ELSE 'not_paid' END;

  v_coord := pu.coordinator_id;
  IF main.phone IS DISTINCT FROM pu.phone OR v_coord IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_coord AND role = 'coordinator' AND is_active) THEN
    v_coord := public.client_coordinator(main.phone);
  END IF;

  UPDATE public.purchases
  SET status = v_status, phone = main.phone, client_id = main.client_id, amount_paise = main.amount_paise,
      paid_at = CASE WHEN v_status IN ('paid', 'refunded') THEN main.paid_at END, coordinator_id = v_coord
  WHERE id = p_purchase
    AND (status, phone, client_id, amount_paise, paid_at, coordinator_id)
        IS DISTINCT FROM (v_status, main.phone, main.client_id, main.amount_paise,
                          CASE WHEN v_status IN ('paid', 'refunded') THEN main.paid_at END, v_coord);

  IF main.status = 'paid' AND main.attempt_id IS NOT NULL THEN
    SELECT a.completed_at INTO v_completed FROM public.attempts a WHERE a.id = main.attempt_id AND a.status = 'completed';
  END IF;

  UPDATE public.purchase_stages SET done_at = CASE WHEN v_status IN ('paid', 'refunded') THEN main.paid_at END
  WHERE purchase_id = p_purchase AND stage = 'payment';
  UPDATE public.purchase_stages SET done_at = v_completed
  WHERE purchase_id = p_purchase AND stage = 'assessment';

  -- Status: done when it has an actual time; the first stage not done is open; the rest wait.
  FOR s IN SELECT stage, done_at FROM public.purchase_stages WHERE purchase_id = p_purchase ORDER BY position LOOP
    UPDATE public.purchase_stages
    SET status = CASE WHEN s.done_at IS NOT NULL THEN 'done' WHEN NOT v_open_set THEN 'open' ELSE 'waiting' END
    WHERE purchase_id = p_purchase AND stage = s.stage;
    IF s.done_at IS NULL THEN
      v_open_set := true;
    END IF;
  END LOOP;
END;
$$;

-- Puts one payment into a row (once) and returns the row, by the LATEST row of the phone and assessment:
--   unpaid try (open, or closed as Not interested) → joins it (as before; Not interested reopens) ·
--   open purchase → history on it (a paid one is caught by the safety net, purchase_extra_paid) ·
--   none, or a finished purchase → a new row.
CREATE OR REPLACE FUNCTION public.purchase_for_payment(p_payment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.payments;
  l public.purchases;
  v_id uuid;
  v_extra boolean := false;
BEGIN
  SELECT purchase_id INTO v_id FROM public.purchase_payments WHERE payment_id = p_payment;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  SELECT * INTO p FROM public.payments WHERE id = p_payment;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Two tries of one phone and assessment at the same moment must not open two rows.
  PERFORM pg_advisory_xact_lock(hashtextextended('payment-attempt:' || p.phone || ':' || p.test_code, 0));

  SELECT * INTO l FROM public.purchase_latest(p.phone, p.test_code);
  IF l.id IS NOT NULL AND l.status = 'not_paid' THEN
    v_id := l.id;
    UPDATE public.purchases SET closed_at = NULL, closed_reason = NULL WHERE id = v_id AND closed_reason = 'not_interested';
  ELSIF public.purchase_is_open(l) THEN
    v_id := l.id;
    -- Already paid when it arrives (a manual payment): the safety net, at once.
    v_extra := p.status = 'paid';
  ELSE
    v_id := public.purchase_new(p.id);
  END IF;

  INSERT INTO public.purchase_payments (payment_id, purchase_id, accounts_check, extra_paid_at)
  VALUES (p.id, v_id, CASE WHEN p.provider = 'offline' THEN 'pending' END, CASE WHEN v_extra THEN now() END);
  IF v_extra THEN
    UPDATE public.payments SET refund_status = 'needed' WHERE id = p.id AND refund_status IS NULL;
  END IF;
  PERFORM public.purchase_refresh(v_id);
  RETURN v_id;
END;
$$;

-- Safety net: a payment that has just become paid while the latest row of the phone and assessment is an OPEN
-- purchase held by ANOTHER paid payment (e.g. two tabs at once). It stays on (or moves to) that purchase as history,
-- is marked Refund needed and starts no second journey. Returns the open purchase when caught, else NULL.
CREATE OR REPLACE FUNCTION public.purchase_extra_paid(p_payment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.payments;
  l public.purchases;
  v_row uuid;
  v_extra timestamptz;
BEGIN
  SELECT * INTO p FROM public.payments WHERE id = p_payment;
  IF NOT FOUND OR p.status <> 'paid' THEN
    RETURN NULL;
  END IF;
  SELECT purchase_id, extra_paid_at INTO v_row, v_extra FROM public.purchase_payments WHERE payment_id = p_payment;
  IF v_row IS NULL THEN
    RETURN NULL;
  END IF;
  IF v_extra IS NOT NULL THEN
    RETURN v_row;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('payment-attempt:' || p.phone || ':' || p.test_code, 0));
  SELECT * INTO l FROM public.purchase_latest(p.phone, p.test_code);
  IF NOT public.purchase_is_open(l)
     OR NOT EXISTS (SELECT 1 FROM public.purchase_payments pp JOIN public.payments x ON x.id = pp.payment_id
                    WHERE pp.purchase_id = l.id AND pp.payment_id <> p.id AND pp.extra_paid_at IS NULL AND x.status = 'paid') THEN
    RETURN NULL;
  END IF;

  UPDATE public.purchase_payments
  SET extra_paid_at = now(), purchase_id = l.id, linked_at = CASE WHEN purchase_id = l.id THEN linked_at ELSE now() END
  WHERE payment_id = p.id;
  UPDATE public.payments SET refund_status = 'needed' WHERE id = p.id AND refund_status IS NULL;
  PERFORM public.purchase_refresh(l.id);
  IF v_row <> l.id THEN
    -- It came from another (unpaid) row: that row is not needed when nothing is left in it.
    IF NOT EXISTS (SELECT 1 FROM public.purchase_payments WHERE purchase_id = v_row) THEN
      PERFORM public.purchase_close_not_needed(v_row, l.paid_at);
    ELSE
      PERFORM public.purchase_refresh(v_row);
    END IF;
  END IF;
  RETURN l.id;
END;
$$;

-- An extra payment moved to another number (Payments → Move) is in use again: it gets its own row and journey.
CREATE OR REPLACE FUNCTION public.purchase_extra_moved(p_payment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old uuid;
  v_new uuid;
BEGIN
  SELECT purchase_id INTO v_old FROM public.purchase_payments WHERE payment_id = p_payment AND extra_paid_at IS NOT NULL;
  IF v_old IS NULL THEN
    RETURN NULL;
  END IF;
  v_new := public.purchase_new(p_payment);
  UPDATE public.purchase_payments SET purchase_id = v_new, extra_paid_at = NULL, linked_at = now() WHERE payment_id = p_payment;
  PERFORM public.purchase_refresh(v_old);
  PERFORM public.purchase_refresh(v_new);
  RETURN v_new;
END;
$$;

-- Same as 20261120110000, except that extra (safety net) payments are left where they are.
CREATE OR REPLACE FUNCTION public.purchase_one_paid(p_payment uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old uuid;
  v_first uuid;
  v_new uuid;
BEGIN
  SELECT pp.purchase_id INTO v_old
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.payment_id = p_payment AND p.status = 'paid' AND pp.extra_paid_at IS NULL;
  IF v_old IS NULL THEN
    RETURN (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = p_payment);
  END IF;

  SELECT p.id INTO v_first
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.purchase_id = v_old AND p.status = 'paid' AND pp.extra_paid_at IS NULL
  ORDER BY coalesce(p.paid_at, p.created_at), p.created_at, p.id
  LIMIT 1;
  IF v_first = p_payment THEN
    RETURN v_old;
  END IF;

  -- A second paid payment in a row that is not open any more (a retake): its own Paid purchase.
  v_new := public.purchase_new(p_payment);
  UPDATE public.purchase_payments SET purchase_id = v_new, linked_at = now() WHERE payment_id = p_payment;
  PERFORM public.purchase_refresh(v_old);
  PERFORM public.purchase_refresh(v_new);
  RETURN v_new;
END;
$$;

-- Same as 20261120120000, plus the safety net (a payment that has just become paid) and a moved extra payment.
CREATE OR REPLACE FUNCTION public.payments_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  BEGIN
    v_id := public.purchase_for_payment(NEW.id);   -- new payment: its row; existing: the one it has
    IF TG_OP = 'UPDATE' AND NEW.phone IS DISTINCT FROM OLD.phone THEN
      v_id := coalesce(public.purchase_extra_moved(NEW.id), v_id);
    END IF;
    IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
      v_id := coalesce(public.purchase_extra_paid(NEW.id), v_id);
    END IF;
    v_id := coalesce(public.purchase_one_paid(NEW.id), v_id);
    IF TG_OP = 'UPDATE' THEN
      PERFORM public.purchase_refresh(v_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Purchase for payment % failed: %', NEW.id, SQLERRM;
  END;
  BEGIN
    IF v_id IS NOT NULL THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM public.calls_log_try(v_id, 'new_try');
      ELSIF NEW.status = 'failed' AND OLD.status IS DISTINCT FROM 'failed' THEN
        PERFORM public.calls_log_try(v_id, 'try_failed');
      END IF;
      PERFORM public.calls_sync_purchase(v_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Calls for payment % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- 5. Who may call the functions ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.purchase_latest(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_is_open(public.purchases) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_open_for(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pay_page_try_blocked(text, text, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_close_not_needed(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_for_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_extra_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_extra_moved(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_one_paid(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_purchase_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_blocked_tries_keep_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_open_for(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pay_page_try_blocked(text, text, boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.purchase_for_payment(uuid) TO service_role;

-- 6. Once: extra unpaid rows of a phone that already had an open purchase (rows changed only) ---------------------
-- An unpaid row (open, or closed as Not interested) whose phone, for the same assessment, already had a Paid purchase
-- before the row's first try, and that purchase is still open: its tries move onto the open purchase as history; the
-- row and its open Payment call close as "Not needed – client already paid on <date>".

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT x.id AS extra_id, zp.id AS open_id, zp.paid_at
    FROM public.purchases x
    CROSS JOIN LATERAL (
      SELECT z.id FROM public.purchases z
      WHERE z.phone = x.phone AND z.test_code = x.test_code AND z.kind = 'assessment' AND z.status = 'paid'
        AND z.created_at < x.created_at AND z.paid_at < x.created_at
      ORDER BY z.created_at DESC, z.id DESC
      LIMIT 1
    ) z
    JOIN public.purchases zp ON zp.id = z.id
    WHERE x.kind = 'assessment' AND x.status = 'not_paid'
      AND (x.closed_at IS NULL OR x.closed_reason = 'not_interested')
      AND public.purchase_is_open(zp)
    ORDER BY x.created_at
  LOOP
    UPDATE public.purchase_payments SET purchase_id = r.open_id, linked_at = now() WHERE purchase_id = r.extra_id;
    PERFORM public.purchase_close_not_needed(r.extra_id, r.paid_at);
    PERFORM public.purchase_refresh(r.open_id);
  END LOOP;
END;
$$;

COMMIT;

-- Step 1 (owner, 2026-11-20): Purchases and the purchase journey. No calls yet.
--
-- REMOVES NOTHING. No DELETE, no DROP, no TRUNCATE. The payments table is not changed: no column is added
-- to it and none of its rows is updated.
--
-- In plain words:
--   1. add_working_hours(at, hours): Mon–Sat 9:00–18:00 India time, Sunday off. "2 working hours" counts only
--      inside those hours (Fri 17:30 + 2 h = Sat 10:30). Used by later steps for planned times.
--   2. One coordinator per client (phone): client_coordinators. A new phone gets the next active coordinator
--      in turn (round robin, coordinator_round_robin); a returning phone keeps its coordinator (round robin
--      again only when that coordinator is no longer active).
--   3. purchases: every pay-page try is a Purchase (type Assessment, which assessment, phone, amount, status).
--      A manual payment for a phone with an open not-paid purchase of the same assessment marks that purchase
--      Paid; otherwise it makes a new Paid purchase. purchase_payments links each payment to its purchase and
--      keeps the accounts check of a manual payment ("pending").
--   4. purchase_stages: the purchase journey, five stages with planned time, actual time and status:
--      Payment → Assessment → Presentation booking → Report presentation → Package call. Payment and
--      Assessment are filled from real data (paid at, assessment completed at).
--   5. Triggers on payments and attempts keep purchases up to date. They never block a payment or a submit.
--   6. Existing payments get their purchases now, oldest first, by the same rules.
--
-- Checks: docs/tasks/21-purchases-verify.sql

BEGIN;

-- 1. Working hours ------------------------------------------------------------------------------------

-- p_at plus p_hours of working time (Mon–Sat 9:00–18:00, Asia/Kolkata; Sunday off).
-- A start outside working time counts from the next opening (Sun 11:00 + 1 h = Mon 10:00).
CREATE OR REPLACE FUNCTION public.add_working_hours(p_at timestamptz, p_hours numeric)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_local timestamp := p_at AT TIME ZONE 'Asia/Kolkata';
  v_left interval := make_interval(secs => greatest(coalesce(p_hours, 0), 0) * 3600);
  v_open timestamp;
  v_close timestamp;
BEGIN
  LOOP
    v_open := date_trunc('day', v_local) + interval '9 hours';
    v_close := date_trunc('day', v_local) + interval '18 hours';
    IF extract(isodow FROM v_local) = 7 OR v_local >= v_close THEN
      v_local := date_trunc('day', v_local) + interval '1 day 9 hours';
      CONTINUE;
    END IF;
    IF v_local < v_open THEN
      v_local := v_open;
    END IF;
    IF v_local + v_left <= v_close THEN
      RETURN (v_local + v_left) AT TIME ZONE 'Asia/Kolkata';
    END IF;
    v_left := v_left - (v_close - v_local);
    v_local := date_trunc('day', v_local) + interval '1 day 9 hours';
  END LOOP;
END;
$$;
COMMENT ON FUNCTION public.add_working_hours(timestamptz, numeric) IS 'Adds working hours: Mon–Sat 9:00–18:00 India time, Sunday off (Fri 17:30 + 2 h = Sat 10:30)';

-- 2. Tables -------------------------------------------------------------------------------------------

CREATE TABLE public.coordinator_round_robin (
  profile_id        uuid PRIMARY KEY REFERENCES public.profiles(id),
  last_assigned_at  timestamptz NOT NULL
);
COMMENT ON TABLE public.coordinator_round_robin IS 'When each coordinator last got a new client. The next new phone goes to the active coordinator who waited longest.';

CREATE TABLE public.client_coordinators (
  phone           text PRIMARY KEY,
  coordinator_id  uuid REFERENCES public.profiles(id),   -- empty = no active coordinator at the time
  assigned_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.client_coordinators IS 'The coordinator of a client (one phone number, E.164). Every purchase of the phone shows this coordinator.';
CREATE INDEX client_coordinators_coordinator_idx ON public.client_coordinators (coordinator_id);

CREATE TABLE public.purchases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL DEFAULT 'assessment' CHECK (kind IN ('assessment')),
  test_code       text NOT NULL,
  phone           text NOT NULL,
  client_id       uuid REFERENCES public.clients(id),
  amount_paise    integer NOT NULL,
  status          text NOT NULL CHECK (status IN ('not_paid', 'paid', 'refunded', 'cancelled')),
  source          text NOT NULL CHECK (source IN ('pay_page', 'manual')),
  coordinator_id  uuid REFERENCES public.profiles(id),
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.purchases IS 'One purchase: a pay-page try, or a manual payment that had no open try. not_paid is shown as "Payment failed". The phone, client and amount follow its payment.';
COMMENT ON COLUMN public.purchases.coordinator_id IS 'The client''s coordinator (client_coordinators) for this phone';
CREATE INDEX purchases_created_idx ON public.purchases (created_at DESC);
CREATE INDEX purchases_coordinator_idx ON public.purchases (coordinator_id, created_at DESC);
CREATE INDEX purchases_phone_idx ON public.purchases (phone, test_code);

CREATE TABLE public.purchase_payments (
  payment_id     uuid PRIMARY KEY REFERENCES public.payments(id),
  purchase_id    uuid NOT NULL REFERENCES public.purchases(id),
  accounts_check text CHECK (accounts_check IN ('pending', 'checked')),
  linked_at      timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.purchase_payments IS 'Which purchase each payment belongs to. accounts_check: manual payments only, "pending" until Accounts has checked it.';
CREATE INDEX purchase_payments_purchase_idx ON public.purchase_payments (purchase_id);

CREATE TABLE public.purchase_stages (
  purchase_id  uuid NOT NULL REFERENCES public.purchases(id),
  stage        text NOT NULL CHECK (stage IN ('payment', 'assessment', 'presentation_booking', 'report_presentation', 'package_call')),
  position     smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  planned_at   timestamptz,
  done_at      timestamptz,
  status       text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'open', 'done')),
  PRIMARY KEY (purchase_id, stage)
);
COMMENT ON TABLE public.purchase_stages IS 'The purchase journey: planned time, actual time (done_at) and status of each stage. open = the stage the purchase is at now.';

CREATE TRIGGER purchases_updated_at BEFORE UPDATE ON public.purchases FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 3. Who sees what -----------------------------------------------------------------------------------
-- Super admins see every purchase; a coordinator sees the purchases of their own clients. Counsellors and
-- clients see none. Only the functions below write (no insert / update / delete rules).

ALTER TABLE public.coordinator_round_robin ENABLE ROW LEVEL SECURITY;
CREATE POLICY coordinator_round_robin_select ON public.coordinator_round_robin FOR SELECT TO authenticated
  USING (public.is_super_admin());

ALTER TABLE public.client_coordinators ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_coordinators_select ON public.client_coordinators FOR SELECT TO authenticated
  USING (public.is_super_admin() OR coordinator_id = public.get_current_staff_profile_id());

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchases_select ON public.purchases FOR SELECT TO authenticated
  USING (public.is_super_admin() OR coordinator_id = public.get_current_staff_profile_id());

ALTER TABLE public.purchase_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_payments_select ON public.purchase_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_payments.purchase_id));

ALTER TABLE public.purchase_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchase_stages_select ON public.purchase_stages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = purchase_stages.purchase_id));

-- 4. Coordinator of a client -------------------------------------------------------------------------

-- The client's coordinator for a phone: the one already assigned while still active, else the active
-- coordinator who waited longest for a new client (round robin). Empty when no coordinator is active.
CREATE OR REPLACE FUNCTION public.client_coordinator(p_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('coordinator-round-robin', 0));
  SELECT c.coordinator_id INTO v FROM public.client_coordinators c WHERE c.phone = p_phone;
  IF v IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v AND role = 'coordinator' AND is_active) THEN
    RETURN v;
  END IF;

  SELECT p.id INTO v
  FROM public.profiles p
  LEFT JOIN public.coordinator_round_robin r ON r.profile_id = p.id
  WHERE p.role = 'coordinator' AND p.is_active
  ORDER BY r.last_assigned_at NULLS FIRST, p.created_at, p.id
  LIMIT 1;

  INSERT INTO public.client_coordinators (phone, coordinator_id, assigned_at) VALUES (p_phone, v, now())
  ON CONFLICT (phone) DO UPDATE SET coordinator_id = EXCLUDED.coordinator_id, assigned_at = EXCLUDED.assigned_at;
  IF v IS NOT NULL THEN
    INSERT INTO public.coordinator_round_robin (profile_id, last_assigned_at) VALUES (v, clock_timestamp())
    ON CONFLICT (profile_id) DO UPDATE SET last_assigned_at = EXCLUDED.last_assigned_at;
  END IF;
  RETURN v;
END;
$$;

-- 5. Purchases ---------------------------------------------------------------------------------------

-- Brings a purchase up to date from its payments and the assessment: status, phone, client, amount, paid at,
-- coordinator, and the Payment and Assessment stages. Safe to run any time.
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

  -- The payment that speaks for the purchase: the paid one, else the latest.
  SELECT p.* INTO main
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.purchase_id = p_purchase
  ORDER BY (p.status = 'paid') DESC, coalesce(p.paid_at, p.created_at) DESC
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

-- Puts one payment into a purchase (once) and returns the purchase. A manual payment that is paid joins the
-- latest open not-paid purchase of the same phone and assessment; every other payment starts its own
-- purchase with the five journey stages.
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

  IF p.provider = 'offline' AND p.status = 'paid' THEN
    SELECT pu.id INTO v_id FROM public.purchases pu
    WHERE pu.phone = p.phone AND pu.test_code = p.test_code AND pu.status = 'not_paid' AND pu.kind = 'assessment'
    ORDER BY pu.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.purchases (kind, test_code, phone, client_id, amount_paise, status, source, coordinator_id, created_at)
    VALUES ('assessment', p.test_code, p.phone, p.client_id, p.amount_paise, 'not_paid',
            CASE WHEN p.provider = 'offline' THEN 'manual' ELSE 'pay_page' END,
            public.client_coordinator(p.phone), p.created_at)
    RETURNING id INTO v_id;
    INSERT INTO public.purchase_stages (purchase_id, stage, position) VALUES
      (v_id, 'payment', 1), (v_id, 'assessment', 2), (v_id, 'presentation_booking', 3),
      (v_id, 'report_presentation', 4), (v_id, 'package_call', 5);
  END IF;

  INSERT INTO public.purchase_payments (payment_id, purchase_id, accounts_check)
  VALUES (p.id, v_id, CASE WHEN p.provider = 'offline' THEN 'pending' END);
  PERFORM public.purchase_refresh(v_id);
  RETURN v_id;
END;
$$;

-- 6. Triggers (never block a payment or an assessment) ------------------------------------------------

CREATE OR REPLACE FUNCTION public.payments_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  BEGIN
    v_id := public.purchase_for_payment(NEW.id);   -- new payment: its purchase; existing: the one it has
    IF TG_OP = 'UPDATE' THEN
      PERFORM public.purchase_refresh(v_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Purchase for payment % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
CREATE TRIGGER payments_purchase AFTER INSERT OR UPDATE OF status, refund_status, phone, client_id, attempt_id, paid_at, amount_paise
  ON public.payments FOR EACH ROW EXECUTE FUNCTION public.payments_purchase_trigger();

CREATE OR REPLACE FUNCTION public.attempts_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  BEGIN
    FOR r IN SELECT pp.purchase_id FROM public.payments p JOIN public.purchase_payments pp ON pp.payment_id = p.id
             WHERE p.attempt_id = NEW.id LOOP
      PERFORM public.purchase_refresh(r.purchase_id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Purchase for attempt % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
CREATE TRIGGER attempts_purchase AFTER UPDATE OF status, completed_at ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.attempts_purchase_trigger();

-- 7. Who may call the functions ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.add_working_hours(timestamptz, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_working_hours(timestamptz, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.client_coordinator(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_refresh(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_for_payment(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payments_purchase_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempts_purchase_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_for_payment(uuid) TO service_role;

-- 8. Existing payments, oldest first (adds rows to the new tables only) -------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.payments ORDER BY created_at, id LOOP
    PERFORM public.purchase_for_payment(r.id);
  END LOOP;
END;
$$;

COMMIT;

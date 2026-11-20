-- Step 2 (owner, 2026-11-20): calls for Payment and Assessment, and "Mark as call done".
-- Run after 20261120110000_payment_attempts.sql.
--
-- REMOVES NOTHING. No DELETE, no DROP, no TRUNCATE. The payments table is not changed. Adds a column to
-- purchases, two tables, functions; replaces the bodies of the two purchase triggers (same triggers) and of
-- the payment_attempts view (one column added at the end).
--
-- In plain words:
--   1. Payment call, on an unpaid payment attempt: starts 30 minutes after the first try if still unpaid, or at
--      once when a payment actually failed. Due 2 working hours after it starts. One per attempt; a new try only
--      adds a line to its history. Closes by itself when the attempt becomes a Paid purchase.
--   2. Assessment call, on a Paid purchase: starts at the paid time, due 2 working hours after payment. Closes by
--      itself when the assessment is completed (stays open while only started). Not made when already completed.
--      The journey's Assessment stage gets planned = this call's due time (actual = completed time, as before).
--   3. Calls are made by the payment and assessment triggers, and by calls_sync() (the admin runs it when My tasks
--      or Purchases opens) for the 30-minute rule. Start and due times come from the events, never from when the
--      sync ran.
--   4. call_mark(): Mark as call done. Done · Call later / Not picked (a follow-up within 2 working days; the call
--      stays open with that due time) · Not interested (only after at least one earlier call; a reason). A note on
--      every choice. Every call and event is kept in call_logs (never changed, never removed). Not interested on a
--      Payment call closes the attempt as "Not interested" (it stays visible under Unpaid).
--   5. Existing purchases and attempts get their calls now, by the same rules.
--
-- Checks: docs/tasks/22-calls-verify.sql

BEGIN;

-- 1. An attempt can be closed as Not interested --------------------------------------------------------

ALTER TABLE public.purchases ADD COLUMN closed_reason text CHECK (closed_reason IN ('replaced', 'not_interested'));
COMMENT ON COLUMN public.purchases.closed_reason IS 'Payment attempts only, with closed_at: replaced (a later try or purchase of the same phone and assessment) or not_interested (from a Payment call).';
UPDATE public.purchases SET closed_reason = 'replaced' WHERE closed_at IS NOT NULL AND closed_reason IS NULL;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_closed_reason_with_closed_at CHECK ((closed_at IS NULL) = (closed_reason IS NULL));

CREATE OR REPLACE VIEW public.payment_attempts WITH (security_invoker = true) AS
SELECT pu.id, pu.test_code, pu.phone, pu.client_id, pu.amount_paise, pu.coordinator_id,
       pu.created_at AS first_tried_at,
       last_try.created_at AS last_tried_at,
       CASE WHEN last_try.status = 'failed' THEN 'failed' ELSE 'not_completed' END AS last_try_status,
       pu.closed_at,
       pu.closed_at IS NULL AS is_open,
       pu.closed_reason
FROM public.purchases pu
LEFT JOIN LATERAL (
  SELECT p.created_at, p.status
  FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
  WHERE pp.purchase_id = pu.id
  ORDER BY p.created_at DESC, p.id DESC
  LIMIT 1
) last_try ON true
WHERE pu.status = 'not_paid';

-- 2. Tables ------------------------------------------------------------------------------------------

CREATE TABLE public.calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  uuid NOT NULL REFERENCES public.purchases(id),
  kind         text NOT NULL CHECK (kind IN ('payment', 'assessment')),
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  outcome      text CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended')),
  created_at   timestamptz NOT NULL,
  due_at       timestamptz NOT NULL,
  closed_at    timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purchase_id, kind),
  CONSTRAINT calls_closed CHECK ((status = 'open') = (outcome IS NULL) AND (status = 'open') = (closed_at IS NULL))
);
COMMENT ON TABLE public.calls IS 'A call the coordinator must make: payment (on an unpaid attempt) or assessment (on a paid purchase). One of each kind per row of purchases. outcome: done / not_interested (Mark as call done), paid / assessment_completed (closed by itself), ended (refunded or cancelled).';
CREATE INDEX calls_open_due_idx ON public.calls (due_at) WHERE status = 'open';
CREATE TRIGGER calls_updated_at BEFORE UPDATE ON public.calls FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE public.call_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id        uuid NOT NULL REFERENCES public.calls(id),
  at             timestamptz NOT NULL DEFAULT now(),
  entry          text NOT NULL CHECK (entry IN ('call', 'event')),
  choice         text CHECK (choice IN ('done', 'call_later', 'not_picked', 'not_interested')),
  reason         text CHECK (reason IN ('too_costly', 'not_now', 'wrong_number', 'other')),
  note           text CHECK (note IS NULL OR length(note) <= 2000),
  follow_up_at   timestamptz,
  event          text CHECK (event IN ('created', 'new_try', 'try_failed', 'paid', 'assessment_completed', 'ended')),
  by_profile_id  uuid REFERENCES public.profiles(id),
  by_name        text,
  CONSTRAINT call_logs_call_has_choice CHECK ((entry = 'call') = (choice IS NOT NULL)),
  CONSTRAINT call_logs_event_has_event CHECK ((entry = 'event') = (event IS NOT NULL)),
  CONSTRAINT call_logs_not_interested_reason CHECK (choice IS DISTINCT FROM 'not_interested' OR reason IS NOT NULL),
  CONSTRAINT call_logs_follow_up CHECK ((choice IN ('call_later', 'not_picked')) = (follow_up_at IS NOT NULL))
);
COMMENT ON TABLE public.call_logs IS 'Call history: every Mark as call done (choice, reason, note, follow-up, who, with the name as it was) and every event (created, new try, payment failed, paid, assessment completed, ended). Never changed, never removed.';
CREATE INDEX call_logs_call_idx ON public.call_logs (call_id, at);

CREATE OR REPLACE FUNCTION public.call_logs_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Call history is never changed or removed.';
END;
$$;
CREATE TRIGGER call_logs_keep BEFORE UPDATE OR DELETE ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.call_logs_keep_trigger();

-- 3. Who sees what: the same people who see the purchase (super admins all, a coordinator their clients). -----

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY calls_select ON public.calls FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = calls.purchase_id));

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY call_logs_select ON public.call_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.calls c WHERE c.id = call_logs.call_id));

-- 4. Making and closing calls --------------------------------------------------------------------------

-- Brings the calls of one row of purchases up to date. Safe to run any time.
CREATE OR REPLACE FUNCTION public.calls_sync_purchase(p_purchase uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  v_failed timestamptz;
  v_start timestamptz;
  v_completed timestamptz;
  v_id uuid;
  v_due timestamptz;
BEGIN
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Payment call.
  IF pu.status = 'not_paid' THEN
    IF pu.closed_at IS NULL AND NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = pu.id AND kind = 'payment') THEN
      SELECT min(p.updated_at) INTO v_failed
      FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
      WHERE pp.purchase_id = pu.id AND p.status = 'failed';
      v_start := least(v_failed, pu.created_at + interval '30 minutes');   -- least() skips an empty v_failed
      IF v_start <= now() THEN
        v_id := NULL;
        INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
        VALUES (pu.id, 'payment', v_start, public.add_working_hours(v_start, 2))
        ON CONFLICT (purchase_id, kind) DO NOTHING
        RETURNING id INTO v_id;
        IF v_id IS NOT NULL THEN
          INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (v_id, v_start, 'event', 'created');
        END IF;
      END IF;
    END IF;
  ELSE
    v_id := NULL;
    UPDATE public.calls
    SET status = 'closed', outcome = CASE WHEN pu.status = 'cancelled' THEN 'ended' ELSE 'paid' END,
        closed_at = CASE WHEN pu.status = 'cancelled' THEN now() ELSE coalesce(pu.paid_at, now()) END
    WHERE purchase_id = pu.id AND kind = 'payment' AND status = 'open'
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      INSERT INTO public.call_logs (call_id, at, entry, event)
      VALUES (v_id, (SELECT closed_at FROM public.calls WHERE id = v_id), 'event',
              CASE WHEN pu.status = 'cancelled' THEN 'ended' ELSE 'paid' END);
    END IF;
  END IF;

  -- Assessment call.
  SELECT done_at INTO v_completed FROM public.purchase_stages WHERE purchase_id = pu.id AND stage = 'assessment';
  IF pu.status = 'paid' AND v_completed IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = pu.id AND kind = 'assessment') THEN
      v_due := public.add_working_hours(pu.paid_at, 2);
      v_id := NULL;
      INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
      VALUES (pu.id, 'assessment', pu.paid_at, v_due)
      ON CONFLICT (purchase_id, kind) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN
        INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (v_id, pu.paid_at, 'event', 'created');
        UPDATE public.purchase_stages SET planned_at = v_due
        WHERE purchase_id = pu.id AND stage = 'assessment' AND planned_at IS NULL;
      END IF;
    END IF;
  ELSE
    v_id := NULL;
    UPDATE public.calls
    SET status = 'closed', outcome = CASE WHEN v_completed IS NOT NULL THEN 'assessment_completed' ELSE 'ended' END,
        closed_at = coalesce(v_completed, now())
    WHERE purchase_id = pu.id AND kind = 'assessment' AND status = 'open'
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      INSERT INTO public.call_logs (call_id, at, entry, event)
      VALUES (v_id, coalesce(v_completed, now()), 'event',
              CASE WHEN v_completed IS NOT NULL THEN 'assessment_completed' ELSE 'ended' END);
    END IF;
  END IF;
END;
$$;

-- Every row that may need a call made or closed now (the 30-minute rule needs this; triggers do the rest).
CREATE OR REPLACE FUNCTION public.calls_sync()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT pu.id FROM public.purchases pu
    WHERE pu.status = 'not_paid' AND pu.closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.purchase_id = pu.id AND c.kind = 'payment')
    UNION
    SELECT pu.id FROM public.purchases pu
    JOIN public.purchase_stages s ON s.purchase_id = pu.id AND s.stage = 'assessment'
    WHERE pu.status = 'paid' AND s.done_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.purchase_id = pu.id AND c.kind = 'assessment')
    UNION
    SELECT c.purchase_id FROM public.calls c WHERE c.status = 'open'
  LOOP
    PERFORM public.calls_sync_purchase(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- A line in the history of the attempt's Payment call (when it has one).
CREATE OR REPLACE FUNCTION public.calls_log_try(p_purchase uuid, p_event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.call_logs (call_id, entry, event)
  SELECT c.id, 'event', p_event FROM public.calls c WHERE c.purchase_id = p_purchase AND c.kind = 'payment';
END;
$$;

-- The purchase triggers now also keep the calls up to date (still never block a payment or an assessment).
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

CREATE OR REPLACE FUNCTION public.attempts_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  BEGIN
    FOR r IN SELECT pp.purchase_id FROM public.payments p JOIN public.purchase_payments pp ON pp.payment_id = p.id
             WHERE p.attempt_id = NEW.id LOOP
      PERFORM public.purchase_refresh(r.purchase_id);
      PERFORM public.calls_sync_purchase(r.purchase_id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Purchase for attempt % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

-- 5. Mark as call done ---------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.call_mark(p_call uuid, p_by uuid, p_choice text, p_reason text, p_note text, p_follow_up timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.calls;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := p_reason;
  v_follow_up timestamptz := p_follow_up;
BEGIN
  SELECT * INTO c FROM public.calls WHERE id = p_call FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This call was not found.';
  END IF;
  IF c.status <> 'open' THEN
    RAISE EXCEPTION 'This call is already closed.';
  END IF;
  IF p_choice IS NULL OR p_choice NOT IN ('done', 'call_later', 'not_picked', 'not_interested') THEN
    RAISE EXCEPTION 'Choose what happened on the call.';
  END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'The note is too long (2,000 characters at most).';
  END IF;

  IF p_choice IN ('call_later', 'not_picked') THEN
    IF v_follow_up IS NULL OR v_follow_up <= now() OR v_follow_up > public.add_working_hours(now(), 18) THEN
      RAISE EXCEPTION 'Pick a follow-up date and time within 2 working days.';
    END IF;
  ELSE
    v_follow_up := NULL;
  END IF;

  IF p_choice = 'not_interested' THEN
    IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = c.id AND entry = 'call') THEN
      RAISE EXCEPTION 'At least one follow-up call is needed first.';
    END IF;
    IF v_reason IS NULL OR v_reason NOT IN ('too_costly', 'not_now', 'wrong_number', 'other') THEN
      RAISE EXCEPTION 'Choose a reason.';
    END IF;
  ELSE
    v_reason := NULL;
  END IF;

  INSERT INTO public.call_logs (call_id, entry, choice, reason, note, follow_up_at, by_profile_id, by_name)
  VALUES (c.id, 'call', p_choice, v_reason, v_note, v_follow_up, p_by,
          (SELECT full_name FROM public.profiles WHERE id = p_by));

  IF p_choice IN ('call_later', 'not_picked') THEN
    UPDATE public.calls SET due_at = v_follow_up WHERE id = c.id;
  ELSE
    UPDATE public.calls SET status = 'closed', outcome = p_choice, closed_at = now() WHERE id = c.id;
    IF p_choice = 'not_interested' AND c.kind = 'payment' THEN
      UPDATE public.purchases SET closed_at = now(), closed_reason = 'not_interested'
      WHERE id = c.purchase_id AND status = 'not_paid' AND closed_at IS NULL;
    END IF;
  END IF;
END;
$$;

-- 6. Who may call the functions ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.calls_sync_purchase(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calls_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calls_log_try(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_logs_keep_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calls_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) TO service_role;
REVOKE ALL ON public.payment_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_attempts TO authenticated, service_role;

-- 7. Existing rows get their calls now ----------------------------------------------------------------

SELECT public.calls_sync();

COMMIT;

-- Step 2 answers (owner, 2026-11-20): calls at go-live, and a new try reopens the Payment call.
-- Run after 20261120120000_calls.sql, in the same session (go-live = the moment this file runs).
--
-- REMOVES NOTHING. No DELETE, no DROP, no TRUNCATE. The payments table is not changed. Adds one table and one
-- column, replaces the bodies of calls_sync_purchase(), calls_sync() and purchase_for_payment(), and updates rows
-- of calls and purchase_stages that the previous file made a moment earlier.
--
-- In plain words:
--   1. Go-live = when this file runs (call_settings.go_live_at).
--      - Paid in the 7 days before go-live, assessment not completed: the Assessment call is due 2 working hours
--        after go-live (not late at go-live).
--      - Paid earlier than that: no automatic call. Its call is closed with the note "Paid more than 7 days
--        before go-live: no automatic call." It stays under Paid (assessment not started) for Admin to decide.
--      - Paid after go-live: as before (due 2 working hours after payment).
--   2. A new try that failed, or is still unpaid 30 minutes later, reopens the attempt's Payment call even when it
--      was Done or Not interested: due 2 working hours after that failure, with the history line "Tried again –
--      failed" (event try_failed). A new try also joins (and reopens) an attempt closed as Not interested.
--
-- Checks: docs/tasks/23-calls-go-live-verify.sql (it replaces docs/tasks/22-calls-verify.sql from now on)

BEGIN;

-- 1. Go-live and a note for calls closed by a rule ---------------------------------------------------------

CREATE TABLE public.call_settings (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  go_live_at  timestamptz NOT NULL
);
COMMENT ON TABLE public.call_settings IS 'One row. go_live_at: when calls started (the go-live file ran). Purchases paid more than 7 days before it get no automatic Assessment call.';
INSERT INTO public.call_settings (go_live_at) VALUES (now());
ALTER TABLE public.call_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY call_settings_select ON public.call_settings FOR SELECT TO authenticated USING (public.is_super_admin());

ALTER TABLE public.calls ADD COLUMN closed_note text;
COMMENT ON COLUMN public.calls.closed_note IS 'Why a rule closed the call, in words (e.g. paid more than 7 days before go-live).';

-- 2. Making, reopening and closing calls ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calls_sync_purchase(p_purchase uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  c public.calls;
  v_go timestamptz;
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
  SELECT go_live_at INTO v_go FROM public.call_settings;

  -- Payment call.
  IF pu.status = 'not_paid' THEN
    SELECT * INTO c FROM public.calls WHERE purchase_id = pu.id AND kind = 'payment';
    IF c.id IS NULL THEN
      -- First call: 30 minutes after the first try, or at once when a payment failed.
      IF pu.closed_at IS NULL THEN
        SELECT min(p.updated_at) INTO v_failed
        FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
        WHERE pp.purchase_id = pu.id AND p.status = 'failed';
        v_start := least(v_failed, pu.created_at + interval '30 minutes');
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
    ELSIF c.status = 'closed' AND c.outcome IN ('done', 'not_interested') THEN
      -- Reopen: a try after the call closed that failed, or is still unpaid 30 minutes later.
      SELECT min(least(CASE WHEN p.status = 'failed' THEN p.updated_at END, p.created_at + interval '30 minutes'))
      INTO v_start
      FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
      WHERE pp.purchase_id = pu.id AND p.created_at > c.closed_at AND p.status IN ('created', 'failed');
      IF v_start IS NOT NULL AND v_start <= now() THEN
        UPDATE public.calls
        SET status = 'open', outcome = NULL, closed_at = NULL, due_at = public.add_working_hours(v_start, 2)
        WHERE id = c.id;
        IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = c.id AND event = 'try_failed' AND at >= c.closed_at) THEN
          INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (c.id, v_start, 'event', 'try_failed');
        END IF;
        UPDATE public.purchases SET closed_at = NULL, closed_reason = NULL
        WHERE id = pu.id AND closed_reason = 'not_interested';
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

  -- Assessment call: only for purchases paid at most 7 days before go-live, or later.
  SELECT done_at INTO v_completed FROM public.purchase_stages WHERE purchase_id = pu.id AND stage = 'assessment';
  IF pu.status = 'paid' AND v_completed IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = pu.id AND kind = 'assessment')
       AND (v_go IS NULL OR pu.paid_at >= v_go - interval '7 days') THEN
      v_start := greatest(pu.paid_at, coalesce(v_go, pu.paid_at));
      v_due := public.add_working_hours(v_start, 2);
      v_id := NULL;
      INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
      VALUES (pu.id, 'assessment', v_start, v_due)
      ON CONFLICT (purchase_id, kind) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN
        INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (v_id, v_start, 'event', 'created');
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

CREATE OR REPLACE FUNCTION public.calls_sync()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
  v_go timestamptz := (SELECT go_live_at FROM public.call_settings);
BEGIN
  FOR r IN
    SELECT pu.id FROM public.purchases pu
    WHERE pu.status = 'not_paid' AND pu.closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.purchase_id = pu.id AND c.kind = 'payment')
    UNION
    SELECT c.purchase_id FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
    WHERE c.kind = 'payment' AND c.status = 'closed' AND c.outcome IN ('done', 'not_interested') AND pu.status = 'not_paid'
      AND EXISTS (SELECT 1 FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
                  WHERE pp.purchase_id = pu.id AND p.created_at > c.closed_at AND p.status IN ('created', 'failed'))
    UNION
    SELECT pu.id FROM public.purchases pu
    JOIN public.purchase_stages s ON s.purchase_id = pu.id AND s.stage = 'assessment'
    WHERE pu.status = 'paid' AND s.done_at IS NULL AND (v_go IS NULL OR pu.paid_at >= v_go - interval '7 days')
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

-- A new try also joins an attempt closed as Not interested (its Payment call then reopens by the rule above).
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

  PERFORM pg_advisory_xact_lock(hashtextextended('payment-attempt:' || p.phone || ':' || p.test_code, 0));

  SELECT pu.id INTO v_id FROM public.purchases pu
  WHERE pu.phone = p.phone AND pu.test_code = p.test_code AND pu.kind = 'assessment'
    AND pu.status = 'not_paid' AND (pu.closed_at IS NULL OR pu.closed_reason = 'not_interested')
  ORDER BY pu.created_at DESC, pu.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    v_id := public.purchase_new(p.id);
  ELSE
    UPDATE public.purchases SET closed_at = NULL, closed_reason = NULL WHERE id = v_id AND closed_reason = 'not_interested';
  END IF;

  INSERT INTO public.purchase_payments (payment_id, purchase_id, accounts_check)
  VALUES (p.id, v_id, CASE WHEN p.provider = 'offline' THEN 'pending' END);
  PERFORM public.purchase_refresh(v_id);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.calls_sync_purchase(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calls_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_for_payment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calls_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.purchase_for_payment(uuid) TO service_role;

-- 3. The calls the previous file just made, by the go-live rules (updates only) ---------------------------

-- Paid in the 7 days before go-live: the Assessment call starts at go-live, due 2 working hours later.
WITH g AS (SELECT go_live_at AS go FROM public.call_settings), moved AS (
  UPDATE public.calls c
  SET created_at = g.go, due_at = public.add_working_hours(g.go, 2)
  FROM public.purchases pu, g
  WHERE pu.id = c.purchase_id AND c.kind = 'assessment' AND c.status = 'open'
    AND pu.paid_at >= g.go - interval '7 days' AND pu.paid_at < g.go
    AND NOT EXISTS (SELECT 1 FROM public.call_logs l WHERE l.call_id = c.id AND l.entry = 'call')
  RETURNING c.purchase_id, c.due_at
)
UPDATE public.purchase_stages s SET planned_at = moved.due_at
FROM moved WHERE s.purchase_id = moved.purchase_id AND s.stage = 'assessment';

-- Paid earlier: no automatic call. The call is closed with a note; the journey has no planned time.
WITH g AS (SELECT go_live_at AS go FROM public.call_settings), closed AS (
  UPDATE public.calls c
  SET status = 'closed', outcome = 'ended', closed_at = g.go,
      closed_note = 'Paid more than 7 days before go-live: no automatic call.'
  FROM public.purchases pu, g
  WHERE pu.id = c.purchase_id AND c.kind = 'assessment' AND c.status = 'open'
    AND pu.paid_at < g.go - interval '7 days'
    AND NOT EXISTS (SELECT 1 FROM public.call_logs l WHERE l.call_id = c.id AND l.entry = 'call')
  RETURNING c.purchase_id
)
UPDATE public.purchase_stages s SET planned_at = NULL
FROM closed WHERE s.purchase_id = closed.purchase_id AND s.stage = 'assessment';

SELECT public.calls_sync();

COMMIT;

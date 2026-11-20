-- Step 2 cleanup (owner, 2026-11-20: "clean up the go-live 'ended' outcome and the reopen event to proper values").
-- Run after 20261120130000_calls_go_live.sql.
--
-- REMOVES NO ROWS. Two allowed-values lists (CHECK rules) are replaced by WIDER ones (owner's standing permission,
-- 2026-11-20): calls.outcome gains 'before_go_live', call_logs.event gains 'reopened'. The calls closed by the
-- go-live rule change their outcome from 'ended' to 'before_go_live' (owner asked for exactly this). Call history
-- rows are never changed. calls_sync_purchase() gets a new body: a reopen also writes a "reopened" line.
--
-- Checks: docs/tasks/23-calls-go-live-verify.sql (updated for these values)

BEGIN;

ALTER TABLE public.calls DROP CONSTRAINT calls_outcome_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended', 'before_go_live'));
COMMENT ON COLUMN public.calls.outcome IS 'done / not_interested (Mark as call done), paid / assessment_completed (closed by itself), ended (refunded or cancelled), before_go_live (paid more than 7 days before go-live: no automatic call).';

UPDATE public.calls SET outcome = 'before_go_live' WHERE outcome = 'ended' AND closed_note IS NOT NULL;

ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_event_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_event_check
  CHECK (event IN ('created', 'new_try', 'try_failed', 'paid', 'assessment_completed', 'ended', 'reopened'));

-- Same as 20261120130000, except that a reopen also writes a "reopened" line.
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
        INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (c.id, v_start, 'event', 'reopened');
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
REVOKE ALL ON FUNCTION public.calls_sync_purchase(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

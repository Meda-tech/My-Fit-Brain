-- STAGING ONLY, ONE TIME (owner permission 2026-11-23, for staging and these objects only).
-- THIS FILE REMOVES database objects: everything that 20261123100000_close_purchase.sql and
-- 20261123200000_package_after_close.sql added on staging. Those two files were never on production and are no longer
-- in the repository; 20261123300000_purchase_finished.sql replaces them. It removes no data rows except the two staging
-- records of those files in supabase_migrations.schema_migrations, and it STOPS if any row still uses a value it takes
-- out of an allowed-values list.
--
-- Removed:
--   * function purchase_close(uuid, text, uuid)
--   * triggers calls_not_for_closed_purchase (calls), presentation_bookings_not_for_closed_purchase (presentation_bookings),
--     purchases_package_after_close (purchases) and their functions
--   * columns purchases.closed_by, closed_by_name, close_note and the rule purchases_closed_by_staff
--   * allowed values: closed_reason 'closed_by_staff', call outcome and call event 'purchase_closed', call kind
--     'package_inform' (the lists go back to what 20261123000000_repeat_payments.sql left)
-- Restored: call_mark() to its body from 20261121300000_packages.sql; the comments on purchases.closed_reason and
-- calls.kind; purchase_is_open() to its body from 20261123000000 (the next migration replaces it anyway).
-- First, with the owner's yes (2026-11-23), the one manual staging test of Close purchase is undone: test number
-- +91 99999 00007 (IA, closed 2026-11-23 3:25 pm IST, note "ai e hi"): its closed fields are emptied, its Assessment
-- call is reopened (it was open before), and its one "Purchase closed" call history line is DELETED (the call history
-- guard is lifted for that one statement only).
--
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-remove-close-purchase.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

-- Undo the one staging test (only rows of the test number +919999900007).
UPDATE public.calls c SET status = 'open', outcome = NULL, closed_at = NULL, closed_note = NULL
FROM public.purchases pu
WHERE pu.id = c.purchase_id AND pu.phone = '+919999900007' AND c.outcome = 'purchase_closed';
ALTER TABLE public.call_logs DISABLE TRIGGER call_logs_keep;
DELETE FROM public.call_logs l USING public.calls c, public.purchases pu
WHERE l.call_id = c.id AND pu.id = c.purchase_id AND pu.phone = '+919999900007' AND l.event = 'purchase_closed';
ALTER TABLE public.call_logs ENABLE TRIGGER call_logs_keep;
UPDATE public.purchases SET closed_at = NULL, closed_reason = NULL, closed_by = NULL, closed_by_name = NULL, close_note = NULL
WHERE phone = '+919999900007' AND closed_reason = 'closed_by_staff';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchases WHERE closed_reason = 'closed_by_staff' OR closed_by IS NOT NULL OR close_note IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.calls WHERE outcome = 'purchase_closed' OR kind = 'package_inform')
     OR EXISTS (SELECT 1 FROM public.call_logs WHERE event = 'purchase_closed') THEN
    RAISE EXCEPTION 'Rows still use the values to remove. Stopping, nothing changed.';
  END IF;
END $$;

-- Triggers and functions.
DROP TRIGGER calls_not_for_closed_purchase ON public.calls;
DROP TRIGGER presentation_bookings_not_for_closed_purchase ON public.presentation_bookings;
DROP TRIGGER purchases_package_after_close ON public.purchases;
DROP FUNCTION public.calls_not_for_closed_purchase_trigger();
DROP FUNCTION public.bookings_not_for_closed_purchase_trigger();
DROP FUNCTION public.purchases_package_after_close_trigger();
DROP FUNCTION public.purchase_close(uuid, text, uuid);

-- Columns and rules.
ALTER TABLE public.purchases DROP CONSTRAINT purchases_closed_by_staff;
ALTER TABLE public.purchases DROP COLUMN closed_by, DROP COLUMN closed_by_name, DROP COLUMN close_note;

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
ALTER TABLE public.calls DROP CONSTRAINT calls_kind_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_kind_check CHECK (kind IN ('payment', 'assessment', 'booking', 'package'));
COMMENT ON COLUMN public.calls.kind IS NULL;

-- purchase_is_open() as 20261123000000 left it.
CREATE OR REPLACE FUNCTION public.purchase_is_open(p public.purchases)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id IS NOT NULL AND p.kind = 'assessment' AND p.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = p.id AND x.kind = 'package' AND x.status = 'paid')
    AND NOT EXISTS (SELECT 1 FROM public.calls c
                    WHERE c.purchase_id = p.id AND c.kind = 'package' AND c.status = 'closed' AND c.outcome = 'not_interested');
$$;
REVOKE ALL ON FUNCTION public.purchase_is_open(public.purchases) FROM PUBLIC, anon, authenticated;

-- call_mark() as 20261121300000_packages.sql left it.
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
  IF p_choice IS NULL OR p_choice NOT IN ('done', 'call_later', 'not_picked', 'not_interested', 'agreed')
     OR (c.kind = 'package' AND p_choice = 'done') OR (c.kind <> 'package' AND p_choice = 'agreed') THEN
    RAISE EXCEPTION 'Choose what happened on the call.';
  END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'The note is too long (2,000 characters at most).';
  END IF;

  IF p_choice IN ('call_later', 'not_picked', 'agreed') THEN
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

  IF p_choice IN ('call_later', 'not_picked', 'agreed') THEN
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
REVOKE ALL ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) TO service_role;

-- The staging records of the two removed files (so staging's history matches the repository).
DELETE FROM supabase_migrations.schema_migrations WHERE version IN ('20261123100000', '20261123200000');

SELECT 'removed: close purchase and package_inform objects; records left: '
       || (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('20261123100000', '20261123200000'));

COMMIT;

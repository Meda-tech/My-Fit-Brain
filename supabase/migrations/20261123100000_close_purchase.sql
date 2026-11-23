-- Finished purchases: "Not interested" on any call, and "Close purchase" (owner, 2026-11-23).
-- Run after 20261123000000_repeat_payments.sql.
--
-- REMOVES NO ROWS. No DELETE, no TRUNCATE, no table or column dropped. Three allowed-values lists (CHECK rules) are
-- replaced by WIDER ones (owner's standing permission, 2026-11-20): purchases.closed_reason + 'closed_by_staff',
-- calls.outcome + 'purchase_closed', call_logs.event + 'purchase_closed'. New columns on purchases (closed_by,
-- closed_by_name, close_note), a new function purchase_close(), two new guard triggers; new body for
-- purchase_is_open().
--
-- In plain words:
--   1. A purchase is FINISHED (no longer open) also when its Assessment, Booking or Package call is closed as Not
--      interested (before: only the Package call), or when staff closed it. A new try or payment of that phone and
--      assessment then starts a new purchase.
--   2. purchase_close(): "Close purchase" on a Paid purchase, by super admins and coordinators (coordinators only for
--      their own clients). Reason required (3 to 300 characters); who and when are recorded. Its open calls close
--      ("Purchase closed: <reason>"). Refused while a presentation is booked and not done ("Cancel the booking first.").
--   3. A closed purchase gets no new call and no new presentation booking (guard triggers). Nothing else changes: the
--      client can still finish a running assessment; payments stay as they are.
--
-- Checks: docs/tasks/35-close-purchase-verify.sql · behaviour test supabase/staging/staging-test-close-purchase.sql

BEGIN;

-- 1. Wider allowed values and the new columns ---------------------------------------------------------------

ALTER TABLE public.purchases DROP CONSTRAINT purchases_closed_reason_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_closed_reason_check
  CHECK (closed_reason IN ('replaced', 'not_interested', 'not_needed', 'closed_by_staff'));
COMMENT ON COLUMN public.purchases.closed_reason IS 'With closed_at. Payment attempts: replaced (a later try or purchase of the same phone and assessment), not_interested (from a Payment call), not_needed (the phone already had an open purchase; its tries are history there). Paid purchases: closed_by_staff ("Close purchase": closed_by, closed_by_name, close_note).';

ALTER TABLE public.purchases
  ADD COLUMN closed_by uuid REFERENCES public.profiles(id),
  ADD COLUMN closed_by_name text,
  ADD COLUMN close_note text;
COMMENT ON COLUMN public.purchases.close_note IS 'Close purchase: the reason staff gave (3 to 300 characters).';
ALTER TABLE public.purchases ADD CONSTRAINT purchases_closed_by_staff
  CHECK (closed_reason IS DISTINCT FROM 'closed_by_staff'
         OR (closed_by IS NOT NULL AND length(btrim(coalesce(close_note, ''))) BETWEEN 3 AND 300));

ALTER TABLE public.calls DROP CONSTRAINT calls_outcome_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended', 'before_go_live', 'booked', 'package_paid',
                     'not_needed', 'purchase_closed'));

ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_event_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_event_check
  CHECK (event IN ('created', 'new_try', 'try_failed', 'paid', 'assessment_completed', 'ended', 'reopened',
                   'presentation_booked', 'booking_cancelled',
                   'package_paid', 'package_payment_failed', 'package_payment_not_completed', 'package_refund_needed',
                   'not_needed', 'purchase_closed'));

-- 2. Open purchase: also finished by Not interested on any call, or closed by staff ---------------------------

CREATE OR REPLACE FUNCTION public.purchase_is_open(p public.purchases)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id IS NOT NULL AND p.kind = 'assessment' AND p.status = 'paid' AND p.closed_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = p.id AND x.kind = 'package' AND x.status = 'paid')
    AND NOT EXISTS (SELECT 1 FROM public.calls c
                    WHERE c.purchase_id = p.id AND c.kind IN ('assessment', 'booking', 'package')
                      AND c.status = 'closed' AND c.outcome = 'not_interested');
$$;

-- 3. Close purchase ------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purchase_close(p_purchase uuid, p_reason text, p_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  v_role text;
  v_name text;
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '\s+', ' ', 'g'));
  c record;
BEGIN
  SELECT role, full_name INTO v_role, v_name FROM public.profiles WHERE id = p_by AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'coordinator') THEN
    RAISE EXCEPTION 'Only coordinators and super admins can close a purchase.';
  END IF;
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase AND kind = 'assessment' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This purchase was not found.';
  END IF;
  IF v_role = 'coordinator' AND pu.coordinator_id IS DISTINCT FROM p_by THEN
    RAISE EXCEPTION 'Only this client''s coordinator can close their purchase.';
  END IF;
  IF pu.closed_reason = 'closed_by_staff' THEN
    RAISE EXCEPTION 'This purchase is already closed.';
  END IF;
  IF pu.status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid purchase can be closed.';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Write the reason (3 to 300 characters).';
  END IF;
  IF EXISTS (SELECT 1 FROM public.presentation_bookings WHERE purchase_id = pu.id AND status = 'booked' AND done_at IS NULL) THEN
    RAISE EXCEPTION 'A presentation is booked. Cancel the booking first.';
  END IF;

  UPDATE public.purchases
  SET closed_at = now(), closed_reason = 'closed_by_staff', closed_by = p_by, closed_by_name = v_name, close_note = v_reason
  WHERE id = pu.id;

  -- Its open calls close, with a history line.
  FOR c IN UPDATE public.calls
           SET status = 'closed', outcome = 'purchase_closed', closed_at = now(), closed_note = 'Purchase closed: ' || v_reason
           WHERE purchase_id = pu.id AND status = 'open'
           RETURNING id LOOP
    INSERT INTO public.call_logs (call_id, entry, event, note, by_profile_id, by_name)
    VALUES (c.id, 'event', 'purchase_closed', v_reason, p_by, v_name);
  END LOOP;
END;
$$;

-- 4. Guards: a closed purchase gets no new call and no new booking --------------------------------------------

CREATE OR REPLACE FUNCTION public.calls_not_for_closed_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchases WHERE id = NEW.purchase_id AND closed_reason = 'closed_by_staff') THEN
    RETURN NULL;   -- not made; every caller already handles "no call made"
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calls_not_for_closed_purchase BEFORE INSERT ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.calls_not_for_closed_purchase_trigger();

CREATE OR REPLACE FUNCTION public.bookings_not_for_closed_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchases WHERE id = NEW.purchase_id AND closed_reason = 'closed_by_staff') THEN
    RAISE EXCEPTION 'This purchase is closed.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER presentation_bookings_not_for_closed_purchase BEFORE INSERT ON public.presentation_bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_not_for_closed_purchase_trigger();

-- 5. Who may call the functions ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.purchase_is_open(public.purchases) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_close(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calls_not_for_closed_purchase_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bookings_not_for_closed_purchase_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purchase_close(uuid, text, uuid) TO service_role;

COMMIT;

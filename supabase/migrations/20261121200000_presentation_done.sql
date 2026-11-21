-- Step 5 (owner, 2026-11-21): the counsellor marks the report presentation done → Package call.
-- Run after 20261121100000_presentation_booking.sql.
--
-- REMOVES NO ROWS. One allowed-values list (CHECK rule) is replaced by a WIDER one (owner's standing permission):
-- calls.kind + 'package'. presentation_bookings gets three columns (done_at, done_by, done_by_name); its keep-trigger
-- and presentation_cancel() get new bodies; new functions and one new trigger on calls.
--
-- In plain words:
--   1. presentation_mark_done(): "Report presentation done". The booked counsellor can mark it from the slot's start
--      time onwards (not before); super admins at any time. Once only. Journey: Report presentation actual = marked
--      time; Package call planned = its due time.
--   2. It creates the Package call for the client's coordinator, due 2 working hours after the marking. Same Mark as
--      call done rules; the app labels Done as "Client agreed". Closing it as Done (Client agreed) fills the journey's
--      Package call actual time (trigger). No package purchase or payment yet.
--   3. A booking marked done can no longer be cancelled.
--
-- Checks: docs/tasks/26-presentation-done-verify.sql

BEGIN;

-- 1. Wider allowed values ------------------------------------------------------------------------------------

ALTER TABLE public.calls DROP CONSTRAINT calls_kind_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_kind_check CHECK (kind IN ('payment', 'assessment', 'booking', 'package'));

-- 2. Presentation done --------------------------------------------------------------------------------------

ALTER TABLE public.presentation_bookings
  ADD COLUMN done_at timestamptz,
  ADD COLUMN done_by uuid REFERENCES public.profiles(id),
  ADD COLUMN done_by_name text;
ALTER TABLE public.presentation_bookings ADD CONSTRAINT presentation_bookings_done
  CHECK (done_at IS NULL OR (status = 'booked' AND done_by_name IS NOT NULL));
COMMENT ON COLUMN public.presentation_bookings.done_at IS 'When the report presentation was marked done (by the counsellor from the slot start, or a super admin).';

-- Never deleted; changed only to cancel it (once, not after done) or to mark it done (once).
CREATE OR REPLACE FUNCTION public.presentation_bookings_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bookings are never removed.';
  END IF;
  IF OLD.status = 'cancelled'
     OR (NEW.purchase_id, NEW.counsellor_id, NEW.on_date, NEW.start_time, NEW.end_time, NEW.booked_at, NEW.booked_by, NEW.booked_by_name)
        IS DISTINCT FROM
        (OLD.purchase_id, OLD.counsellor_id, OLD.on_date, OLD.start_time, OLD.end_time, OLD.booked_at, OLD.booked_by, OLD.booked_by_name)
     OR (OLD.done_at IS NOT NULL
         AND (NEW.status, NEW.done_at, NEW.done_by, NEW.done_by_name) IS DISTINCT FROM (OLD.status, OLD.done_at, OLD.done_by, OLD.done_by_name)) THEN
    RAISE EXCEPTION 'A booking can only be cancelled or marked done, once.';
  END IF;
  RETURN NEW;
END;
$$;

-- Same as 20261121100000, plus: a presentation marked done cannot be cancelled.
CREATE OR REPLACE FUNCTION public.presentation_cancel(p_booking uuid, p_reason text, p_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.presentation_bookings;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_name text;
  v_call uuid;
  v_due timestamptz := public.add_working_hours(now(), 2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'Only super admins can cancel a booking.';
  END IF;
  IF length(v_reason) < 3 OR length(v_reason) > 300 THEN
    RAISE EXCEPTION 'Write the reason (3 to 300 characters).';
  END IF;
  SELECT * INTO b FROM public.presentation_bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This booking was not found.';
  END IF;
  IF b.status <> 'booked' THEN
    RAISE EXCEPTION 'This booking was already cancelled.';
  END IF;
  IF b.done_at IS NOT NULL THEN
    RAISE EXCEPTION 'This presentation was already marked done. It cannot be cancelled.';
  END IF;
  v_name := (SELECT full_name FROM public.profiles WHERE id = p_by);

  UPDATE public.presentation_bookings
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_by, cancelled_by_name = v_name, cancel_reason = v_reason
  WHERE id = b.id;

  UPDATE public.purchase_stages SET done_at = NULL WHERE purchase_id = b.purchase_id AND stage = 'presentation_booking';
  UPDATE public.purchase_stages SET planned_at = NULL WHERE purchase_id = b.purchase_id AND stage = 'report_presentation';
  PERFORM public.purchase_refresh(b.purchase_id);

  SELECT id INTO v_call FROM public.calls WHERE purchase_id = b.purchase_id AND kind = 'booking';
  IF v_call IS NULL THEN
    INSERT INTO public.calls (purchase_id, kind, created_at, due_at) VALUES (b.purchase_id, 'booking', now(), v_due)
    RETURNING id INTO v_call;
    INSERT INTO public.call_logs (call_id, entry, event) VALUES (v_call, 'event', 'created');
  ELSE
    UPDATE public.calls SET status = 'open', outcome = NULL, closed_at = NULL, due_at = v_due WHERE id = v_call;
  END IF;
  INSERT INTO public.call_logs (call_id, entry, event, note, by_profile_id, by_name)
  VALUES (v_call, 'event', 'booking_cancelled',
          (SELECT full_name FROM public.profiles WHERE id = b.counsellor_id) || ', ' || public.presentation_label(b.on_date, b.start_time)
            || ' · ' || v_reason,
          p_by, v_name);
END;
$$;

-- "Report presentation done": the booked counsellor from the slot's start; super admins at any time; once.
CREATE OR REPLACE FUNCTION public.presentation_mark_done(p_booking uuid, p_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.presentation_bookings;
  v_role text;
  v_name text;
  v_due timestamptz := public.add_working_hours(now(), 2);
  v_call uuid;
BEGIN
  SELECT role, full_name INTO v_role, v_name FROM public.profiles WHERE id = p_by AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('counsellor', 'super_admin') THEN
    RAISE EXCEPTION 'Only the counsellor or a super admin can mark the presentation done.';
  END IF;
  SELECT * INTO b FROM public.presentation_bookings WHERE id = p_booking FOR UPDATE;
  IF NOT FOUND OR b.status <> 'booked' THEN
    RAISE EXCEPTION 'This booking was not found.';
  END IF;
  IF v_role = 'counsellor' AND b.counsellor_id <> p_by THEN
    RAISE EXCEPTION 'Only the counsellor of this presentation can mark it done.';
  END IF;
  IF b.done_at IS NOT NULL THEN
    RAISE EXCEPTION 'This presentation is already marked done.';
  END IF;
  IF v_role = 'counsellor' AND now() < (b.on_date + b.start_time) AT TIME ZONE 'Asia/Kolkata' THEN
    RAISE EXCEPTION 'It can be marked done from the start of the slot.';
  END IF;

  UPDATE public.presentation_bookings SET done_at = now(), done_by = p_by, done_by_name = v_name WHERE id = b.id;

  -- Journey: Report presentation actual = now; Package call planned = the Package call's due time.
  UPDATE public.purchase_stages SET done_at = now() WHERE purchase_id = b.purchase_id AND stage = 'report_presentation';
  UPDATE public.purchase_stages SET planned_at = v_due WHERE purchase_id = b.purchase_id AND stage = 'package_call';
  PERFORM public.purchase_refresh(b.purchase_id);

  -- The Package call, for the client's coordinator (whoever sees the purchase).
  INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
  VALUES (b.purchase_id, 'package', now(), v_due)
  ON CONFLICT (purchase_id, kind) DO NOTHING
  RETURNING id INTO v_call;
  IF v_call IS NOT NULL THEN
    INSERT INTO public.call_logs (call_id, entry, event) VALUES (v_call, 'event', 'created');
  END IF;
END;
$$;

-- Package call closed as Done ("Client agreed") → the journey's Package call actual time.
CREATE OR REPLACE FUNCTION public.calls_package_journey_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind = 'package' AND NEW.status = 'closed' AND NEW.outcome = 'done' AND OLD.status = 'open' THEN
    UPDATE public.purchase_stages SET done_at = NEW.closed_at
    WHERE purchase_id = NEW.purchase_id AND stage = 'package_call' AND done_at IS NULL;
    PERFORM public.purchase_refresh(NEW.purchase_id);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER calls_package_journey AFTER UPDATE OF status ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.calls_package_journey_trigger();

REVOKE ALL ON FUNCTION public.presentation_cancel(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.presentation_mark_done(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calls_package_journey_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presentation_cancel(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.presentation_mark_done(uuid, uuid) TO service_role;

COMMIT;

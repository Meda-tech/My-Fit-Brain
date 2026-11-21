-- Before the system (owner, 2026-11-21): "No historical data is needed. Old clients stay as they are; only new
-- purchases after go-live run the flow." Run after 20261121600000_counsellor_clients.sql.
--
-- REMOVES NOTHING. No row is deleted.
-- * New before_system(purchases): paid more than 7 days before go-live (call_settings.go_live_at); for a try that
--   was never paid, its latest try more than 7 days before go-live. Readable as a column ("before_system").
-- * New trigger on calls: no call of any kind (Payment, Assessment, Booking, Package) is ever made for such a purchase.
-- * Open calls of such purchases are closed now (outcome before_go_live, note "Before the system: no automatic
--   call."), also ones worked before go-live. Their call history stays as it is.
-- * presentation_book(): new body (same as 20261121500000, plus one check): such a purchase cannot be booked, so no
--   counsellor is ever assigned an old client through it. Bookings already made are not touched.
--
-- Checks: docs/tasks/31-before-system-verify.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.before_system(p public.purchases)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    coalesce(p.paid_at,
             (SELECT max(pay.created_at) FROM public.purchase_payments pp JOIN public.payments pay ON pay.id = pp.payment_id
              WHERE pp.purchase_id = p.id),
             p.created_at)
      < (SELECT go_live_at FROM public.call_settings) - interval '7 days',
    false);
$$;
COMMENT ON FUNCTION public.before_system(public.purchases) IS 'Before the system: paid (or, never paid, last tried) more than 7 days before go-live. No calls, no booking; the journey shows "Before the system".';

CREATE OR REPLACE FUNCTION public.calls_before_system_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT public.before_system(pu) FROM public.purchases pu WHERE pu.id = NEW.purchase_id) THEN
    RETURN NULL;   -- not made; every caller already handles "no call made"
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calls_before_system BEFORE INSERT ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.calls_before_system_trigger();

UPDATE public.calls c
SET status = 'closed', outcome = 'before_go_live', closed_at = now(), closed_note = 'Before the system: no automatic call.'
FROM public.purchases pu
WHERE pu.id = c.purchase_id AND c.status = 'open' AND public.before_system(pu);

-- Same as 20261121500000, plus: a purchase from before the system cannot be booked.
CREATE OR REPLACE FUNCTION public.presentation_book(p_purchase uuid, p_counsellor uuid, p_date date, p_start time, p_by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  v_role text;
  v_end time;
  v_state text;
  v_at timestamptz;
  v_id uuid;
  v_call uuid;
  v_label text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = p_by AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'coordinator') THEN
    RAISE EXCEPTION 'Only coordinators and super admins can book a presentation.';
  END IF;
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This purchase was not found.';
  END IF;
  IF v_role = 'coordinator' AND pu.coordinator_id IS DISTINCT FROM p_by THEN
    RAISE EXCEPTION 'Only this client''s coordinator can book their presentation.';
  END IF;
  IF pu.status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid purchase can be booked.';
  END IF;
  IF public.before_system(pu) THEN
    RAISE EXCEPTION 'This purchase is from before the system. It is not booked here.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_stages WHERE purchase_id = pu.id AND stage = 'assessment' AND done_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The assessment is not completed yet.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.presentation_bookings WHERE purchase_id = pu.id AND status = 'booked') THEN
    RAISE EXCEPTION 'A presentation is already booked for this purchase.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_counsellor AND role = 'counsellor' AND is_active) THEN
    RAISE EXCEPTION 'Choose an active counsellor.';
  END IF;
  -- Only the next 3 working days (owner, 2026-11-21).
  IF p_date > public.booking_last_day() THEN
    RAISE EXCEPTION 'Pick a slot in the next 3 working days.';
  END IF;

  -- One booking at a time per counsellor and day; the unique index is the last guard.
  PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || p_counsellor || ':' || p_date, 0));
  SELECT s.end_time, s.state INTO v_end, v_state
  FROM public.counsellor_slots(p_counsellor, p_date, p_date) s WHERE s.start_time = p_start;
  IF v_state IS DISTINCT FROM 'free' THEN
    RAISE EXCEPTION 'This slot is no longer free. Pick another.';
  END IF;
  v_at := (p_date + p_start) AT TIME ZONE 'Asia/Kolkata';
  IF v_at <= now() THEN
    RAISE EXCEPTION 'This slot has already started. Pick a later one.';
  END IF;

  BEGIN
    INSERT INTO public.presentation_bookings (purchase_id, counsellor_id, on_date, start_time, end_time, booked_by, booked_by_name)
    VALUES (pu.id, p_counsellor, p_date, p_start, v_end, p_by, (SELECT full_name FROM public.profiles WHERE id = p_by))
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This slot was just booked by someone else. Pick another.';
  END;

  -- Journey: Presentation booking actual = now; Report presentation planned = the slot.
  UPDATE public.purchase_stages SET done_at = now() WHERE purchase_id = pu.id AND stage = 'presentation_booking';
  UPDATE public.purchase_stages SET planned_at = v_at WHERE purchase_id = pu.id AND stage = 'report_presentation';
  PERFORM public.purchase_refresh(pu.id);

  -- The Booking call closes, with "Presentation booked: <counsellor>, <date time>".
  v_label := (SELECT full_name FROM public.profiles WHERE id = p_counsellor) || ', ' || public.presentation_label(p_date, p_start);
  SELECT id INTO v_call FROM public.calls WHERE purchase_id = pu.id AND kind = 'booking';
  IF v_call IS NOT NULL THEN
    UPDATE public.calls SET status = 'closed', outcome = 'booked', closed_at = now() WHERE id = v_call AND status = 'open';
    INSERT INTO public.call_logs (call_id, entry, event, note, by_profile_id, by_name)
    VALUES (v_call, 'event', 'presentation_booked', v_label, p_by, (SELECT full_name FROM public.profiles WHERE id = p_by));
  END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.calls_before_system_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.before_system(public.purchases) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.before_system(public.purchases) TO authenticated, service_role;

COMMIT;

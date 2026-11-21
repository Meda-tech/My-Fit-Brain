-- Book presentation: only the next 3 working days (owner, 2026-11-21: "show him only the next 3 working days slot
-- only, not more than that at all"). Run after 20261121400001_presentation_label_range.sql.
--
-- REMOVES NOTHING. Bookings already made are not touched, whatever their date.
-- * New booking_last_day(): today counts when it is a working day; working days = availability_settings.work_days
--   (Monday–Saturday). E.g. Friday → Friday, Saturday, Monday; Sunday → Monday, Tuesday, Wednesday. A custom slot on
--   a day off (e.g. Sunday) inside that window can be booked too.
-- * free_presentation_slots(): new body, never lists a slot after booking_last_day().
-- * presentation_book(): new body (same as 20261121100000, plus one check): refuses a date after booking_last_day(),
--   for every role.
--
-- Checks: docs/tasks/29-booking-window-verify.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.booking_last_day(p_today date DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date)
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT d::date
  FROM generate_series(p_today, p_today + 60, interval '1 day') d
  WHERE extract(isodow FROM d)::int = ANY (
    coalesce((SELECT work_days FROM public.availability_settings LIMIT 1), '{1,2,3,4,5,6}')::int[])
  ORDER BY d
  OFFSET 2 LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.booking_last_day(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_last_day(date) TO service_role;

CREATE OR REPLACE FUNCTION public.free_presentation_slots(p_from date, p_to date)
RETURNS TABLE (counsellor_id uuid, counsellor_name text, on_date date, start_time time, end_time time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, s.on_date, s.start_time, s.end_time
  FROM public.profiles p
  CROSS JOIN LATERAL public.counsellor_slots(p.id, p_from, least(p_to, public.booking_last_day())) s
  WHERE p.role = 'counsellor' AND p.is_active AND s.state = 'free'
    AND s.on_date <= public.booking_last_day()
    AND (s.on_date + s.start_time) AT TIME ZONE 'Asia/Kolkata' > now()
  ORDER BY s.on_date, p.full_name, s.start_time;
$$;

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

COMMIT;

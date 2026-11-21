-- Step 4 (owner, 2026-11-21): Booking call and "Book presentation".
-- Run after 20261121000001_counsellor_availability.sql.
--
-- REMOVES NO ROWS. Three allowed-values lists (CHECK rules) are replaced by WIDER ones (owner's standing permission,
-- 2026-11-20): calls.kind + 'booking', calls.outcome + 'booked', call_logs.event + 'presentation_booked' and
-- 'booking_cancelled'. New table presentation_bookings, new functions; new bodies for calls_sync_purchase(),
-- calls_sync() and availability_booked().
--
-- In plain words:
--   1. Booking call (on a Paid purchase): starts when the assessment is completed, due 2 working hours later.
--      Same Mark as call done rules. Journey: Presentation booking planned = its due time. Go-live rule as for the
--      Assessment call: completed more than 7 days before go-live → no automatic call; completed in the 7 days
--      before → starts at go-live.
--   2. presentation_book(): books a FREE future slot of an active counsellor (counsellor_slots()). The database
--      refuses a double booking (one active booking per counsellor slot, one per purchase). Coordinators book only
--      for their own clients; super admins for anyone. On booking: Presentation booking actual = booked at, Report
--      presentation planned = the slot; the Booking call closes with the line "Presentation booked: <counsellor>,
--      <date time>".
--   3. presentation_cancel(): super admins only, reason required. The booking row stays (cancelled, who, when, why);
--      the slot is free again; the journey goes back to Presentation booking; the Booking call reopens, due 2
--      working hours later, with a history line.
--   4. availability_booked() now reads the bookings, so the availability screen shows Booked and refuses Mark off /
--      Undo over a booked slot.
--
-- Checks: docs/tasks/25-booking-verify.sql

BEGIN;

-- 1. Wider allowed values ------------------------------------------------------------------------------------

ALTER TABLE public.calls DROP CONSTRAINT calls_kind_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_kind_check CHECK (kind IN ('payment', 'assessment', 'booking'));
ALTER TABLE public.calls DROP CONSTRAINT calls_outcome_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended', 'before_go_live', 'booked'));
ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_event_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_event_check
  CHECK (event IN ('created', 'new_try', 'try_failed', 'paid', 'assessment_completed', 'ended', 'reopened',
                   'presentation_booked', 'booking_cancelled'));

-- 2. Bookings ---------------------------------------------------------------------------------------------

CREATE TABLE public.presentation_bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id        uuid NOT NULL REFERENCES public.purchases(id),
  counsellor_id      uuid NOT NULL REFERENCES public.profiles(id),
  on_date            date NOT NULL,
  start_time         time NOT NULL,
  end_time           time NOT NULL,
  status             text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  booked_at          timestamptz NOT NULL DEFAULT now(),
  booked_by          uuid REFERENCES public.profiles(id),
  booked_by_name     text,
  cancelled_at       timestamptz,
  cancelled_by       uuid REFERENCES public.profiles(id),
  cancelled_by_name  text,
  cancel_reason      text,
  CONSTRAINT presentation_bookings_range CHECK (start_time < end_time),
  CONSTRAINT presentation_bookings_cancelled CHECK (
    (status = 'cancelled') = (cancelled_at IS NOT NULL)
    AND (status <> 'cancelled' OR (length(btrim(coalesce(cancel_reason, ''))) BETWEEN 3 AND 300)))
);
COMMENT ON TABLE public.presentation_bookings IS 'The report presentation booked for a purchase: counsellor, date and slot (India time), who booked it and when. Cancelled (super admins, with a reason) keeps the row. Never deleted.';
-- The database refuses a double booking: one active booking per counsellor slot, one per purchase.
CREATE UNIQUE INDEX presentation_bookings_slot_uniq ON public.presentation_bookings (counsellor_id, on_date, start_time) WHERE status = 'booked';
CREATE UNIQUE INDEX presentation_bookings_purchase_uniq ON public.presentation_bookings (purchase_id) WHERE status = 'booked';
CREATE INDEX presentation_bookings_day_idx ON public.presentation_bookings (counsellor_id, on_date);

CREATE OR REPLACE FUNCTION public.presentation_bookings_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bookings are never removed.';
  END IF;
  IF OLD.status = 'cancelled'
     OR (NEW.purchase_id, NEW.counsellor_id, NEW.on_date, NEW.start_time, NEW.end_time, NEW.booked_at, NEW.booked_by, NEW.booked_by_name)
        IS DISTINCT FROM
        (OLD.purchase_id, OLD.counsellor_id, OLD.on_date, OLD.start_time, OLD.end_time, OLD.booked_at, OLD.booked_by, OLD.booked_by_name) THEN
    RAISE EXCEPTION 'A booking can only be cancelled, once.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER presentation_bookings_keep BEFORE UPDATE OR DELETE ON public.presentation_bookings
  FOR EACH ROW EXECUTE FUNCTION public.presentation_bookings_keep_trigger();

-- Whoever sees the purchase sees its bookings (super admins all, a coordinator their clients).
ALTER TABLE public.presentation_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY presentation_bookings_select ON public.presentation_bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = presentation_bookings.purchase_id));

-- 3. Booked slots ------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.availability_booked(p_counsellor uuid, p_date date, p_start time, p_end time)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.presentation_bookings b
    WHERE b.counsellor_id = p_counsellor AND b.on_date = p_date AND b.status = 'booked'
      AND b.start_time < p_end AND b.end_time > p_start
  );
$$;

-- Free slots of every active counsellor that start after now (India time), for "Book presentation".
CREATE OR REPLACE FUNCTION public.free_presentation_slots(p_from date, p_to date)
RETURNS TABLE (counsellor_id uuid, counsellor_name text, on_date date, start_time time, end_time time)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.full_name, s.on_date, s.start_time, s.end_time
  FROM public.profiles p
  CROSS JOIN LATERAL public.counsellor_slots(p.id, p_from, p_to) s
  WHERE p.role = 'counsellor' AND p.is_active AND s.state = 'free'
    AND (s.on_date + s.start_time) AT TIME ZONE 'Asia/Kolkata' > now()
  ORDER BY s.on_date, p.full_name, s.start_time;
$$;

-- 4. Calls (same as 20261121000000, plus the Booking call at the end) -------------------------------------

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
  v_booked boolean;
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

  -- Booking call (step 4): from the completed assessment until a presentation is booked. Go-live rule: completed
  -- more than 7 days before go-live → no automatic call; in the 7 days before → it starts at go-live.
  v_booked := EXISTS (SELECT 1 FROM public.presentation_bookings WHERE purchase_id = pu.id AND status = 'booked');
  IF pu.status = 'paid' AND v_completed IS NOT NULL AND NOT v_booked THEN
    IF NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = pu.id AND kind = 'booking')
       AND (v_go IS NULL OR v_completed >= v_go - interval '7 days') THEN
      v_start := greatest(v_completed, coalesce(v_go, v_completed));
      v_due := public.add_working_hours(v_start, 2);
      v_id := NULL;
      INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
      VALUES (pu.id, 'booking', v_start, v_due)
      ON CONFLICT (purchase_id, kind) DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN
        INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (v_id, v_start, 'event', 'created');
        UPDATE public.purchase_stages SET planned_at = v_due
        WHERE purchase_id = pu.id AND stage = 'presentation_booking' AND planned_at IS NULL;
      END IF;
    END IF;
  ELSIF pu.status <> 'paid' THEN
    v_id := NULL;
    UPDATE public.calls SET status = 'closed', outcome = 'ended', closed_at = now()
    WHERE purchase_id = pu.id AND kind = 'booking' AND status = 'open'
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      INSERT INTO public.call_logs (call_id, entry, event) VALUES (v_id, 'event', 'ended');
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
    SELECT pu.id FROM public.purchases pu
    JOIN public.purchase_stages s ON s.purchase_id = pu.id AND s.stage = 'assessment'
    WHERE pu.status = 'paid' AND s.done_at IS NOT NULL AND (v_go IS NULL OR s.done_at >= v_go - interval '7 days')
      AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.purchase_id = pu.id AND c.kind = 'booking')
      AND NOT EXISTS (SELECT 1 FROM public.presentation_bookings b WHERE b.purchase_id = pu.id AND b.status = 'booked')
    UNION
    SELECT c.purchase_id FROM public.calls c WHERE c.status = 'open'
  LOOP
    PERFORM public.calls_sync_purchase(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- 5. Book and cancel ------------------------------------------------------------------------------------

-- "Mon 23 Nov 2026, 10:00" (India time, 24-hour, as the team writes it).
CREATE OR REPLACE FUNCTION public.presentation_label(p_date date, p_start time)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_date, 'Dy FMDD Mon YYYY') || ', ' || to_char(p_start, 'FMHH24:MI');
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
  v_name := (SELECT full_name FROM public.profiles WHERE id = p_by);

  UPDATE public.presentation_bookings
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = p_by, cancelled_by_name = v_name, cancel_reason = v_reason
  WHERE id = b.id;

  -- Journey back to Presentation booking.
  UPDATE public.purchase_stages SET done_at = NULL WHERE purchase_id = b.purchase_id AND stage = 'presentation_booking';
  UPDATE public.purchase_stages SET planned_at = NULL WHERE purchase_id = b.purchase_id AND stage = 'report_presentation';
  PERFORM public.purchase_refresh(b.purchase_id);

  -- The Booking call reopens (or starts), due 2 working hours from now, with a history line.
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

-- 6. Who may call the functions ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.calls_sync_purchase(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calls_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.availability_booked(uuid, date, time, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.free_presentation_slots(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.presentation_book(uuid, uuid, date, time, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.presentation_cancel(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.presentation_bookings_keep_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calls_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.availability_booked(uuid, date, time, time) TO service_role;
GRANT EXECUTE ON FUNCTION public.free_presentation_slots(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.presentation_book(uuid, uuid, date, time, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.presentation_cancel(uuid, text, uuid) TO service_role;

-- 7. Existing completed assessments get their Booking calls now (go-live rule) -------------------------------

SELECT public.calls_sync();

COMMIT;

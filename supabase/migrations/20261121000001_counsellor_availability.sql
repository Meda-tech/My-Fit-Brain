-- Step 3 (owner, 2026-11-20): counsellor availability (super admins only). Nothing is booked in this step.
-- Run after 20261121000000_calls_cleanup.sql.
--
-- REMOVES NOTHING. No DELETE, no DROP, no TRUNCATE. New tables and functions only.
--
-- In plain words:
--   1. availability_settings (one row): the default for every active counsellor, stored once (a Settings screen
--      can change it later): 30-minute slots, Monday–Saturday, 9:00–18:00, no gap, lunch 13:00–13:30
--      → 9:00, 9:30 … 12:30, 13:30 … 17:30 = 17 slots a day. Sunday off.
--   2. availability_changes: per counsellor and date, a Mark off (the whole day, or a time range, with an optional
--      reason) or custom slots (a time range split into slots). Who added it and when; Undo sets removed_at / by
--      (the row stays, so the history is complete). Rows are never deleted (trigger).
--   3. counsellor_slots(counsellor, from, to): every slot of those dates with its state Free / Booked / Off. The one
--      place that turns the default and the changes into slots (screens and, later, booking use it).
--   4. availability_booked(): is any slot of a counsellor booked in a time range? Nothing can be booked yet, so it
--      answers "no"; the booking step replaces its body.
--   5. availability_add() / availability_remove(): the only writers. Super admins only (checked here and in the app).
--      Undo is refused when any slot of the change is booked.
--
-- Checks: docs/tasks/24-availability-verify.sql

BEGIN;

-- 1. The default, stored once ----------------------------------------------------------------------------

CREATE TABLE public.availability_settings (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  slot_minutes  integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 10 AND 240),
  gap_minutes   integer NOT NULL DEFAULT 0 CHECK (gap_minutes BETWEEN 0 AND 120),
  work_days     smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}' CHECK (work_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  day_start     time NOT NULL DEFAULT '09:00',
  day_end       time NOT NULL DEFAULT '18:00',
  lunch_start   time DEFAULT '13:00',
  lunch_end     time DEFAULT '13:30',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES public.profiles(id),
  CONSTRAINT availability_settings_day CHECK (day_start < day_end),
  CONSTRAINT availability_settings_lunch CHECK ((lunch_start IS NULL) = (lunch_end IS NULL) AND (lunch_start IS NULL OR lunch_start < lunch_end))
);
COMMENT ON TABLE public.availability_settings IS 'One row: the default availability of every active counsellor. work_days = ISO weekdays (1 Monday … 7 Sunday). Times are India time.';
INSERT INTO public.availability_settings DEFAULT VALUES;
CREATE TRIGGER availability_settings_updated_at BEFORE UPDATE ON public.availability_settings
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Mark off and custom slots, with their history ---------------------------------------------------------

CREATE TABLE public.availability_changes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id    uuid NOT NULL REFERENCES public.profiles(id),
  kind             text NOT NULL CHECK (kind IN ('off', 'custom')),
  on_date          date NOT NULL,
  start_time       time,
  end_time         time,
  reason           text CHECK (reason IS NULL OR length(reason) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.profiles(id),
  created_by_name  text,
  removed_at       timestamptz,
  removed_by       uuid REFERENCES public.profiles(id),
  removed_by_name  text,
  CONSTRAINT availability_changes_range CHECK ((start_time IS NULL) = (end_time IS NULL) AND (start_time IS NULL OR start_time < end_time)),
  CONSTRAINT availability_changes_custom_range CHECK (kind = 'off' OR start_time IS NOT NULL),
  CONSTRAINT availability_changes_removed CHECK ((removed_at IS NULL) = (removed_by_name IS NULL))
);
COMMENT ON TABLE public.availability_changes IS 'Per counsellor and date: off (whole day when no times, else a range; optional reason) or custom slots (a range split into slots). removed_at = undone (kept for the history). Never deleted.';
CREATE INDEX availability_changes_day_idx ON public.availability_changes (counsellor_id, on_date);

-- A change is never deleted; the only update allowed is Undo (setting removed_*, once).
CREATE OR REPLACE FUNCTION public.availability_changes_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Availability history is never removed.';
  END IF;
  IF OLD.removed_at IS NOT NULL
     OR (NEW.counsellor_id, NEW.kind, NEW.on_date, NEW.start_time, NEW.end_time, NEW.reason, NEW.created_at, NEW.created_by, NEW.created_by_name)
        IS DISTINCT FROM
        (OLD.counsellor_id, OLD.kind, OLD.on_date, OLD.start_time, OLD.end_time, OLD.reason, OLD.created_at, OLD.created_by, OLD.created_by_name) THEN
    RAISE EXCEPTION 'An availability change can only be undone, once.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER availability_changes_keep BEFORE UPDATE OR DELETE ON public.availability_changes
  FOR EACH ROW EXECUTE FUNCTION public.availability_changes_keep_trigger();

-- 3. Who sees what: super admins only (counsellors and coordinators cannot see or change availability yet). ----

ALTER TABLE public.availability_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_settings_select ON public.availability_settings FOR SELECT TO authenticated USING (public.is_super_admin());
ALTER TABLE public.availability_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY availability_changes_select ON public.availability_changes FOR SELECT TO authenticated USING (public.is_super_admin());

-- 4. Slots -------------------------------------------------------------------------------------------------

-- Is any slot of the counsellor booked between p_start and p_end on p_date? Nothing can be booked yet (step 3);
-- the booking step replaces this body.
CREATE OR REPLACE FUNCTION public.availability_booked(p_counsellor uuid, p_date date, p_start time, p_end time)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT false;
$$;

-- Every slot of a counsellor between two dates: the default slots of the work days (lunch skipped) plus custom
-- slots, one slot per start time (a default slot wins over a custom one at the same time). State: booked, else off
-- (a Mark off covers it: whole day or overlapping range), else free.
CREATE OR REPLACE FUNCTION public.counsellor_slots(p_counsellor uuid, p_from date, p_to date)
RETURNS TABLE (on_date date, start_time time, end_time time, state text, custom_change uuid, off_change uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH s AS (
    SELECT slot_minutes AS sm, gap_minutes AS gm, work_days,
           (extract(epoch FROM day_start) / 60)::int AS ds, (extract(epoch FROM day_end) / 60)::int AS de,
           (extract(epoch FROM lunch_start) / 60)::int AS ls, (extract(epoch FROM lunch_end) / 60)::int AS le
    FROM public.availability_settings
  ),
  days AS (
    SELECT d::date AS on_date FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ),
  defaults AS (
    SELECT days.on_date, m AS start_min, m + s.sm AS end_min, NULL::uuid AS custom_change
    FROM days CROSS JOIN s CROSS JOIN LATERAL generate_series(s.ds, s.de - s.sm, s.sm + s.gm) m
    WHERE extract(isodow FROM days.on_date)::smallint = ANY (s.work_days)
      AND NOT (s.ls IS NOT NULL AND m < s.le AND m + s.sm > s.ls)
  ),
  customs AS (
    SELECT c.on_date, m AS start_min, m + s.sm AS end_min, c.id AS custom_change
    FROM public.availability_changes c CROSS JOIN s
    CROSS JOIN LATERAL generate_series((extract(epoch FROM c.start_time) / 60)::int,
                                       (extract(epoch FROM c.end_time) / 60)::int - s.sm, s.sm) m
    WHERE c.counsellor_id = p_counsellor AND c.kind = 'custom' AND c.removed_at IS NULL
      AND c.on_date BETWEEN p_from AND p_to
  ),
  slots AS (
    SELECT DISTINCT ON (x.on_date, x.start_min) x.*
    FROM (SELECT * FROM defaults UNION ALL SELECT * FROM customs) x
    ORDER BY x.on_date, x.start_min, x.custom_change NULLS FIRST
  )
  SELECT sl.on_date,
         time '00:00' + make_interval(mins => sl.start_min),
         time '00:00' + make_interval(mins => sl.end_min),
         CASE
           WHEN public.availability_booked(p_counsellor, sl.on_date, time '00:00' + make_interval(mins => sl.start_min),
                                           time '00:00' + make_interval(mins => sl.end_min)) THEN 'booked'
           WHEN off.id IS NOT NULL THEN 'off'
           ELSE 'free'
         END,
         sl.custom_change,
         off.id
  FROM slots sl
  LEFT JOIN LATERAL (
    SELECT o.id FROM public.availability_changes o
    WHERE o.counsellor_id = p_counsellor AND o.kind = 'off' AND o.removed_at IS NULL AND o.on_date = sl.on_date
      AND (o.start_time IS NULL
           OR (o.start_time < time '00:00' + make_interval(mins => sl.end_min)
               AND o.end_time > time '00:00' + make_interval(mins => sl.start_min)))
    ORDER BY o.created_at
    LIMIT 1
  ) off ON true
  ORDER BY sl.on_date, sl.start_min;
$$;

-- 5. The writers (super admins only) ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.availability_add(p_counsellor uuid, p_kind text, p_date date, p_start time, p_end time, p_reason text, p_by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sm integer := (SELECT slot_minutes FROM public.availability_settings);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_minutes integer;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'Only super admins can change availability.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_counsellor AND role = 'counsellor' AND is_active) THEN
    RAISE EXCEPTION 'Choose an active counsellor.';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('off', 'custom') THEN
    RAISE EXCEPTION 'Choose Mark off or Add custom slots.';
  END IF;
  IF p_date IS NULL OR p_date < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Pick today or a later date.';
  END IF;
  IF (p_start IS NULL) <> (p_end IS NULL) OR (p_start IS NOT NULL AND p_start >= p_end) THEN
    RAISE EXCEPTION 'The end time must be after the start time.';
  END IF;
  IF length(v_reason) > 300 THEN
    RAISE EXCEPTION 'The reason is too long (300 characters at most).';
  END IF;

  -- Serialise changes of one counsellor and day.
  PERFORM pg_advisory_xact_lock(hashtextextended('availability:' || p_counsellor || ':' || p_date, 0));

  IF p_kind = 'off' THEN
    IF EXISTS (SELECT 1 FROM public.availability_changes WHERE counsellor_id = p_counsellor AND on_date = p_date
               AND kind = 'off' AND start_time IS NULL AND removed_at IS NULL) THEN
      RAISE EXCEPTION 'This day is already off.';
    END IF;
    IF public.availability_booked(p_counsellor, p_date, coalesce(p_start, time '00:00'), coalesce(p_end, time '23:59:59')) THEN
      RAISE EXCEPTION 'Some of these slots are booked. Move those bookings first.';
    END IF;
  ELSE
    IF p_start IS NULL THEN
      RAISE EXCEPTION 'Choose a time range for the custom slots.';
    END IF;
    v_minutes := (extract(epoch FROM p_end - p_start) / 60)::int;
    IF v_minutes % v_sm <> 0 THEN
      RAISE EXCEPTION 'The time range must be a whole number of %-minute slots.', v_sm;
    END IF;
    IF EXISTS (SELECT 1 FROM public.availability_changes WHERE counsellor_id = p_counsellor AND on_date = p_date
               AND kind = 'custom' AND removed_at IS NULL AND start_time < p_end AND end_time > p_start) THEN
      RAISE EXCEPTION 'Custom slots already cover part of this time.';
    END IF;
    v_reason := NULL;
  END IF;

  INSERT INTO public.availability_changes (counsellor_id, kind, on_date, start_time, end_time, reason, created_by, created_by_name)
  VALUES (p_counsellor, p_kind, p_date, p_start, p_end, v_reason, p_by, (SELECT full_name FROM public.profiles WHERE id = p_by))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Undo: only when none of the change's slots is booked. The row stays, marked removed.
CREATE OR REPLACE FUNCTION public.availability_remove(p_change uuid, p_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.availability_changes;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'Only super admins can change availability.';
  END IF;
  SELECT * INTO c FROM public.availability_changes WHERE id = p_change FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This change was not found.';
  END IF;
  IF c.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This change was already undone.';
  END IF;
  IF public.availability_booked(c.counsellor_id, c.on_date, coalesce(c.start_time, time '00:00'), coalesce(c.end_time, time '23:59:59')) THEN
    RAISE EXCEPTION 'Some of its slots are booked, so it cannot be undone.';
  END IF;
  UPDATE public.availability_changes
  SET removed_at = now(), removed_by = p_by, removed_by_name = (SELECT full_name FROM public.profiles WHERE id = p_by)
  WHERE id = c.id;
END;
$$;

-- 6. Who may call the functions ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.availability_booked(uuid, date, time, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.counsellor_slots(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.availability_add(uuid, text, date, time, time, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.availability_remove(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.availability_changes_keep_trigger() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.availability_booked(uuid, date, time, time) TO service_role;
GRANT EXECUTE ON FUNCTION public.counsellor_slots(uuid, date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.availability_add(uuid, text, date, time, time, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.availability_remove(uuid, uuid) TO service_role;

COMMIT;

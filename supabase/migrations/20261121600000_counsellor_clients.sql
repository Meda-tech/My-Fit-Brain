-- Counsellors see only their own clients; moving a counsellor's clients; no "Make inactive" while they have any
-- (owner, 2026-11-21). Run after 20261121500000_booking_three_working_days.sql.
--
-- REMOVES NOTHING. No row is deleted or changed except as described; no existing access rule is dropped.
-- * New table client_counsellors: a client is assigned to a counsellor when a presentation is booked with them
--   (filled now from every booking so far, cancelled ones too). Rows are never deleted: a move closes a row
--   (ended_at) and opens one for the new counsellor.
-- * New RESTRICTIVE access rules on clients, attempts, attempt_answers, attempt_details, attempt_results,
--   attempt_alerts and attempt_conclusions: a counsellor reads only the rows of their assigned clients. They only
--   narrow what a counsellor sees; super admins, coordinators and clients see exactly what they saw before.
--   NOTE for production: from this file on, a counsellor sees no client until a presentation is booked with them.
-- * New table counsellor_client_moves and function move_counsellor_clients(): all clients of one counsellor go to
--   another active counsellor, with their upcoming booked presentations (same date and time). Refused, with nothing
--   moved, when the new counsellor is not free at any of those times (counsellor_move_clashes() lists them). Past
--   presentations keep their counsellor.
-- * New body of presentation_bookings_keep_trigger(): the counsellor of an upcoming booking may change, only inside
--   move_counsellor_clients(). Everything else as before.
-- * New trigger: a counsellor with clients or upcoming presentations cannot be made inactive ("Move their clients
--   first.").
--
-- Checks: docs/tasks/30-counsellor-clients-verify.sql

BEGIN;

-- 1. Moves (the log) -----------------------------------------------------------------------------------------

CREATE TABLE public.counsellor_client_moves (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_counsellor_id    uuid NOT NULL REFERENCES public.profiles(id),
  to_counsellor_id      uuid NOT NULL REFERENCES public.profiles(id),
  client_ids            uuid[] NOT NULL,
  booking_ids           uuid[] NOT NULL,
  moved_by              uuid REFERENCES public.profiles(id),
  moved_by_name         text,
  moved_at              timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.counsellor_client_moves IS 'Each time a super admin moved all clients of one counsellor (and their upcoming presentations, booking_ids) to another. Never changed or removed.';

-- 2. Assignments ---------------------------------------------------------------------------------------------

CREATE TABLE public.client_counsellors (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id),
  counsellor_id  uuid NOT NULL REFERENCES public.profiles(id),
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  booking_id     uuid REFERENCES public.presentation_bookings(id),   -- assigned by this booking
  move_id        uuid REFERENCES public.counsellor_client_moves(id), -- or by this move
  ended_at       timestamptz,
  ended_by_move  uuid REFERENCES public.counsellor_client_moves(id),
  CONSTRAINT client_counsellors_source CHECK ((booking_id IS NULL) <> (move_id IS NULL)),
  CONSTRAINT client_counsellors_end CHECK ((ended_at IS NULL) = (ended_by_move IS NULL))
);
COMMENT ON TABLE public.client_counsellors IS 'Which counsellor may see which client: assigned when a presentation is booked with them, or by a move. ended_at = moved to another counsellor. Never removed.';
CREATE UNIQUE INDEX client_counsellors_active ON public.client_counsellors (client_id, counsellor_id) WHERE ended_at IS NULL;
CREATE INDEX client_counsellors_counsellor_idx ON public.client_counsellors (counsellor_id) WHERE ended_at IS NULL;

-- Never removed; only ended once (by a move).
CREATE OR REPLACE FUNCTION public.client_counsellors_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assignments are never removed.';
  END IF;
  IF OLD.ended_at IS NOT NULL
     OR (NEW.client_id, NEW.counsellor_id, NEW.assigned_at, NEW.booking_id, NEW.move_id)
        IS DISTINCT FROM (OLD.client_id, OLD.counsellor_id, OLD.assigned_at, OLD.booking_id, OLD.move_id) THEN
    RAISE EXCEPTION 'An assignment can only be ended, once.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER client_counsellors_keep BEFORE UPDATE OR DELETE ON public.client_counsellors
  FOR EACH ROW EXECUTE FUNCTION public.client_counsellors_keep_trigger();

CREATE OR REPLACE FUNCTION public.counsellor_client_moves_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Moves are never changed or removed.';
END;
$$;
CREATE TRIGGER counsellor_client_moves_keep BEFORE UPDATE OR DELETE ON public.counsellor_client_moves
  FOR EACH ROW EXECUTE FUNCTION public.counsellor_client_moves_keep_trigger();

-- A booking assigns the client to its counsellor (kept after the presentation and after a cancel).
CREATE OR REPLACE FUNCTION public.presentation_bookings_assign_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client uuid;
BEGIN
  SELECT client_id INTO v_client FROM public.purchases WHERE id = NEW.purchase_id;
  IF v_client IS NOT NULL THEN
    INSERT INTO public.client_counsellors (client_id, counsellor_id, booking_id)
    VALUES (v_client, NEW.counsellor_id, NEW.id)
    ON CONFLICT (client_id, counsellor_id) WHERE ended_at IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER presentation_bookings_assign AFTER INSERT ON public.presentation_bookings
  FOR EACH ROW EXECUTE FUNCTION public.presentation_bookings_assign_trigger();

-- Every booking so far (the first booking of each client and counsellor).
INSERT INTO public.client_counsellors (client_id, counsellor_id, assigned_at, booking_id)
SELECT DISTINCT ON (pu.client_id, b.counsellor_id) pu.client_id, b.counsellor_id, b.booked_at, b.id
FROM public.presentation_bookings b
JOIN public.purchases pu ON pu.id = b.purchase_id
WHERE pu.client_id IS NOT NULL
ORDER BY pu.client_id, b.counsellor_id, b.booked_at;

-- 3. Who sees what -------------------------------------------------------------------------------------------

-- The signed-in user's profile id when they are a counsellor (active or not), else null.
CREATE OR REPLACE FUNCTION public.counsellor_login()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()) AND role = 'counsellor' LIMIT 1;
$$;

-- The clients / attempts the signed-in counsellor may see (none when inactive).
CREATE OR REPLACE FUNCTION public.counsellor_client_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cc.client_id
  FROM public.client_counsellors cc
  JOIN public.profiles p ON p.id = cc.counsellor_id
  WHERE p.auth_user_id = (SELECT auth.uid()) AND p.role = 'counsellor' AND p.is_active AND cc.ended_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.counsellor_attempt_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id FROM public.attempts a WHERE a.client_id IN (SELECT public.counsellor_client_ids());
$$;

-- RESTRICTIVE: applies on top of the existing rules, and only narrows them for counsellors.
CREATE POLICY clients_counsellor_own ON public.clients AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.counsellor_login()) IS NULL OR id IN (SELECT public.counsellor_client_ids()))
  WITH CHECK ((SELECT public.counsellor_login()) IS NULL OR id IN (SELECT public.counsellor_client_ids()));
CREATE POLICY attempts_counsellor_own ON public.attempts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.counsellor_login()) IS NULL OR client_id IN (SELECT public.counsellor_client_ids()))
  WITH CHECK ((SELECT public.counsellor_login()) IS NULL OR client_id IN (SELECT public.counsellor_client_ids()));
CREATE POLICY attempt_answers_counsellor_own ON public.attempt_answers AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()))
  WITH CHECK ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()));
CREATE POLICY attempt_details_counsellor_own ON public.attempt_details AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()))
  WITH CHECK ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()));
CREATE POLICY attempt_results_counsellor_own ON public.attempt_results AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()))
  WITH CHECK ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()));
CREATE POLICY attempt_alerts_counsellor_own ON public.attempt_alerts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()))
  WITH CHECK ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()));
CREATE POLICY attempt_conclusions_counsellor_own ON public.attempt_conclusions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()))
  WITH CHECK ((SELECT public.counsellor_login()) IS NULL OR attempt_id IN (SELECT public.counsellor_attempt_ids()));

ALTER TABLE public.client_counsellors ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_counsellors_select ON public.client_counsellors FOR SELECT TO authenticated
  USING (public.is_super_admin() OR counsellor_id = public.get_current_staff_profile_id());

ALTER TABLE public.counsellor_client_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY counsellor_client_moves_select ON public.counsellor_client_moves FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- 4. Moving a counsellor's clients -----------------------------------------------------------------------------

-- Upcoming = booked, not marked done, slot not started yet.
CREATE OR REPLACE FUNCTION public.counsellor_move_clashes(p_from uuid, p_to uuid)
RETURNS TABLE (booking_id uuid, on_date date, start_time time, end_time time, client_name text, client_phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.on_date, b.start_time, b.end_time, c.full_name, pu.phone
  FROM public.presentation_bookings b
  JOIN public.purchases pu ON pu.id = b.purchase_id
  LEFT JOIN public.clients c ON c.id = pu.client_id
  WHERE b.counsellor_id = p_from AND b.status = 'booked' AND b.done_at IS NULL
    AND (b.on_date + b.start_time) AT TIME ZONE 'Asia/Kolkata' > now()
    AND NOT EXISTS (SELECT 1 FROM public.counsellor_slots(p_to, b.on_date, b.on_date) s
                    WHERE s.start_time = b.start_time AND s.state = 'free')
  ORDER BY b.on_date, b.start_time;
$$;

-- Returns {"clients": n, "presentations": n}.
CREATE OR REPLACE FUNCTION public.move_counsellor_clients(p_from uuid, p_to uuid, p_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_date date;
  v_clients uuid[];
  v_bookings uuid[];
  v_move uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'Only super admins can move clients.';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_from AND role = 'counsellor') THEN
    RAISE EXCEPTION 'Choose another counsellor.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND role = 'counsellor' AND is_active) THEN
    RAISE EXCEPTION 'The new counsellor must be an active counsellor.';
  END IF;

  -- One move at a time; and no booking on the days involved meanwhile (same locks as presentation_book()).
  PERFORM pg_advisory_xact_lock(hashtextextended('counsellor-move', 0));
  FOR v_date IN
    SELECT DISTINCT b.on_date FROM public.presentation_bookings b
    WHERE b.counsellor_id = p_from AND b.status = 'booked' AND b.done_at IS NULL
      AND (b.on_date + b.start_time) AT TIME ZONE 'Asia/Kolkata' > now()
    ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || p_to || ':' || v_date, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('booking:' || p_from || ':' || v_date, 0));
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.counsellor_move_clashes(p_from, p_to)) THEN
    RAISE EXCEPTION 'The new counsellor is not free at some of these times. Pick another counsellor.';
  END IF;

  SELECT coalesce(array_agg(b.id ORDER BY b.on_date, b.start_time), '{}') INTO v_bookings
  FROM public.presentation_bookings b
  WHERE b.counsellor_id = p_from AND b.status = 'booked' AND b.done_at IS NULL
    AND (b.on_date + b.start_time) AT TIME ZONE 'Asia/Kolkata' > now();
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_clients FROM (
    SELECT client_id AS x FROM public.client_counsellors WHERE counsellor_id = p_from AND ended_at IS NULL
    UNION
    SELECT pu.client_id FROM public.presentation_bookings b JOIN public.purchases pu ON pu.id = b.purchase_id
    WHERE b.id = ANY (v_bookings) AND pu.client_id IS NOT NULL
  ) s;

  INSERT INTO public.counsellor_client_moves (from_counsellor_id, to_counsellor_id, client_ids, booking_ids, moved_by, moved_by_name)
  VALUES (p_from, p_to, v_clients, v_bookings, p_by, (SELECT full_name FROM public.profiles WHERE id = p_by))
  RETURNING id INTO v_move;

  UPDATE public.client_counsellors SET ended_at = now(), ended_by_move = v_move
  WHERE counsellor_id = p_from AND ended_at IS NULL;
  INSERT INTO public.client_counsellors (client_id, counsellor_id, move_id)
  SELECT x, p_to, v_move FROM unnest(v_clients) x
  ON CONFLICT (client_id, counsellor_id) WHERE ended_at IS NULL DO NOTHING;

  PERFORM set_config('mfb.counsellor_move', 'on', true);
  UPDATE public.presentation_bookings SET counsellor_id = p_to WHERE id = ANY (v_bookings);
  PERFORM set_config('mfb.counsellor_move', 'off', true);

  RETURN jsonb_build_object('clients', cardinality(v_clients), 'presentations', cardinality(v_bookings));
END;
$$;

-- Same as 20261121200000, plus: inside move_counsellor_clients() the counsellor of an upcoming booking may change.
CREATE OR REPLACE FUNCTION public.presentation_bookings_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_moving boolean := TG_OP = 'UPDATE' AND current_setting('mfb.counsellor_move', true) = 'on'
                      AND OLD.status = 'booked' AND OLD.done_at IS NULL
                      AND (OLD.on_date + OLD.start_time) AT TIME ZONE 'Asia/Kolkata' > now();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bookings are never removed.';
  END IF;
  IF OLD.status = 'cancelled'
     OR (NEW.purchase_id, CASE WHEN v_moving THEN OLD.counsellor_id ELSE NEW.counsellor_id END, NEW.on_date, NEW.start_time,
         NEW.end_time, NEW.booked_at, NEW.booked_by, NEW.booked_by_name)
        IS DISTINCT FROM
        (OLD.purchase_id, OLD.counsellor_id, OLD.on_date, OLD.start_time, OLD.end_time, OLD.booked_at, OLD.booked_by, OLD.booked_by_name)
     OR (OLD.done_at IS NOT NULL
         AND (NEW.status, NEW.done_at, NEW.done_by, NEW.done_by_name) IS DISTINCT FROM (OLD.status, OLD.done_at, OLD.done_by, OLD.done_by_name)) THEN
    RAISE EXCEPTION 'A booking can only be cancelled or marked done, once.';
  END IF;
  RETURN NEW;
END;
$$;

-- 5. No "Make inactive" while a counsellor still has clients or upcoming presentations --------------------------

CREATE OR REPLACE FUNCTION public.profiles_keep_counsellor_clients_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'counsellor' AND OLD.is_active AND NOT NEW.is_active
     AND (EXISTS (SELECT 1 FROM public.client_counsellors WHERE counsellor_id = OLD.id AND ended_at IS NULL)
          OR EXISTS (SELECT 1 FROM public.presentation_bookings b
                     WHERE b.counsellor_id = OLD.id AND b.status = 'booked' AND b.done_at IS NULL
                       AND (b.on_date + b.start_time) AT TIME ZONE 'Asia/Kolkata' > now())) THEN
    RAISE EXCEPTION 'Move their clients first.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_keep_counsellor_clients BEFORE UPDATE OF is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_keep_counsellor_clients_trigger();

-- 6. Who may call ----------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.client_counsellors_keep_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.counsellor_client_moves_keep_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.presentation_bookings_assign_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_keep_counsellor_clients_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.counsellor_move_clashes(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_counsellor_clients(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.counsellor_move_clashes(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_counsellor_clients(uuid, uuid, uuid) TO service_role;
-- The access functions run inside the rules, as the signed-in user.
REVOKE ALL ON FUNCTION public.counsellor_login() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.counsellor_client_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.counsellor_attempt_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.counsellor_login() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.counsellor_client_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.counsellor_attempt_ids() TO authenticated, service_role;

COMMIT;

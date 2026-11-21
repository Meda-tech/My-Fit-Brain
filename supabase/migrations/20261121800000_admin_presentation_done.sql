-- Old purchases: "Mark report presentation done" by an admin, and the one-time go-live assignment of old clients
-- (owner, 2026-11-21). Run after 20261121700001_before_system_planned.sql.
--
-- REMOVES NOTHING. No row is deleted. Three rules become WIDER (owner's standing permission); no row changes for them:
--   * presentation_bookings.start_time / end_time may now be empty (only for a presentation marked by an admin,
--     which uses no slot; new column marked_by_admin, new CHECK presentation_bookings_admin);
--   * client_counsellors may also be assigned at go-live (new column at_go_live; the CHECK client_counsellors_source
--     is replaced by a wider one);
--   * the trigger that makes no calls for purchases from before the system now lets the Package call through
--     (Payment, Assessment and Booking calls are still never made for them).
--
-- In plain words:
--   1. presentation_mark_done_admin(): a super admin marks the report presentation of an OLD paid assessment
--      purchase (before the system, assessment completed, no booking) as done: counsellor and the date it happened
--      (today or earlier), no slot. It is stored as a presentation marked done ("Marked by admin"), so from then on
--      everything works as for a new purchase: the client sees the package offer in the app, a Package call is made
--      for the client's coordinator (due 2 working hours later), the client is assigned to that counsellor.
--      The offer still appears only once a report presentation is marked done (package_offer() is not changed).
--   2. go_live_assign_old_clients(): the one-time go-live step. All existing clients get the only active
--      coordinator; all existing clients with a paid assessment are assigned to the only active counsellor. It STOPS
--      and changes nothing unless there is exactly one active coordinator and one active counsellor. It is run once,
--      by pasting supabase/go-live/assign-old-clients.sql (this file only adds the function).
--
-- Checks: docs/tasks/32-admin-presentation-verify.sql

BEGIN;

-- 1. A presentation without a slot ------------------------------------------------------------------------------

ALTER TABLE public.presentation_bookings
  ALTER COLUMN start_time DROP NOT NULL,
  ALTER COLUMN end_time DROP NOT NULL,
  ADD COLUMN marked_by_admin boolean NOT NULL DEFAULT false;
ALTER TABLE public.presentation_bookings ADD CONSTRAINT presentation_bookings_admin
  CHECK ((start_time IS NULL) = marked_by_admin AND (end_time IS NULL) = marked_by_admin
         AND (NOT marked_by_admin OR done_at IS NOT NULL));
COMMENT ON COLUMN public.presentation_bookings.marked_by_admin IS 'An old purchase (before the system): a super admin marked the report presentation done. on_date = the date it happened; no slot (start_time / end_time empty).';

-- 2. No automatic calls for purchases from before the system; the Package call is made --------------------------

CREATE OR REPLACE FUNCTION public.calls_before_system_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind IN ('payment', 'assessment', 'booking')
     AND (SELECT public.before_system(pu) FROM public.purchases pu WHERE pu.id = NEW.purchase_id) THEN
    RETURN NULL;   -- not made; every caller already handles "no call made"
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Mark report presentation done (admin, old purchases) -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.presentation_mark_done_admin(p_purchase uuid, p_counsellor uuid, p_date date, p_by uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  v_name text;
  v_due timestamptz := public.add_working_hours(now(), 2);
  v_id uuid;
  v_call uuid;
BEGIN
  SELECT full_name INTO v_name FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Only super admins can mark this presentation done.';
  END IF;
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase AND kind = 'assessment' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This purchase was not found.';
  END IF;
  IF pu.status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid purchase can be marked.';
  END IF;
  IF NOT public.before_system(pu) THEN
    RAISE EXCEPTION 'This purchase runs the normal flow. Book the presentation instead.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_stages WHERE purchase_id = pu.id AND stage = 'assessment' AND done_at IS NOT NULL) THEN
    RAISE EXCEPTION 'The assessment is not completed yet.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.presentation_bookings WHERE purchase_id = pu.id AND status = 'booked') THEN
    RAISE EXCEPTION 'This purchase already has a presentation.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_counsellor AND role = 'counsellor' AND is_active) THEN
    RAISE EXCEPTION 'Choose an active counsellor.';
  END IF;
  IF p_date IS NULL OR p_date > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'Choose today or an earlier date.';
  END IF;

  -- Stored as a presentation marked done, without a slot. The client is assigned to the counsellor by the trigger
  -- presentation_bookings_assign, like any booking.
  BEGIN
    INSERT INTO public.presentation_bookings
      (purchase_id, counsellor_id, on_date, start_time, end_time, booked_by, booked_by_name, marked_by_admin, done_at, done_by, done_by_name)
    VALUES (pu.id, p_counsellor, p_date, NULL, NULL, p_by, v_name, true, now(), p_by, v_name)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This purchase already has a presentation.';
  END;

  -- Journey: the steps before the presentation are "Before the system"; Report presentation actual = now;
  -- Package call planned = its due time.
  UPDATE public.purchase_stages SET done_at = now(), planned_at = NULL
  WHERE purchase_id = pu.id AND stage = 'presentation_booking' AND done_at IS NULL;
  UPDATE public.purchase_stages SET done_at = now() WHERE purchase_id = pu.id AND stage = 'report_presentation';
  UPDATE public.purchase_stages SET planned_at = v_due WHERE purchase_id = pu.id AND stage = 'package_call';
  PERFORM public.purchase_refresh(pu.id);

  -- The Package call, for the client's coordinator (whoever sees the purchase).
  INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
  VALUES (pu.id, 'package', now(), v_due)
  ON CONFLICT (purchase_id, kind) DO NOTHING
  RETURNING id INTO v_call;
  IF v_call IS NOT NULL THEN
    INSERT INTO public.call_logs (call_id, entry, event) VALUES (v_call, 'event', 'created');
  END IF;
  RETURN v_id;
END;
$$;

-- 4. Go-live: old clients get the only coordinator and the only counsellor --------------------------------------

ALTER TABLE public.client_counsellors ADD COLUMN at_go_live boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.client_counsellors.at_go_live IS 'Assigned by the one-time go-live step (go_live_assign_old_clients()): an existing client with a paid assessment.';
ALTER TABLE public.client_counsellors DROP CONSTRAINT client_counsellors_source;
ALTER TABLE public.client_counsellors ADD CONSTRAINT client_counsellors_source
  CHECK (num_nonnulls(booking_id, move_id) + at_go_live::int = 1);

-- Returns {"coordinator": name, "counsellor": name, "phones": n, "purchases": n, "clients_to_counsellor": n}.
-- Safe to run again: it only adds what is missing.
CREATE OR REPLACE FUNCTION public.go_live_assign_old_clients()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_coordinators integer;
  v_counsellors integer;
  v_coordinator uuid;
  v_counsellor uuid;
  n_phones integer;
  n_purchases integer;
  n_clients integer;
BEGIN
  SELECT count(*) INTO v_coordinators FROM public.profiles WHERE role = 'coordinator' AND is_active;
  SELECT count(*) INTO v_counsellors FROM public.profiles WHERE role = 'counsellor' AND is_active;
  IF v_coordinators <> 1 OR v_counsellors <> 1 THEN
    RAISE EXCEPTION 'Stopped, nothing was changed: this step needs exactly one active coordinator and one active counsellor. Found % active coordinator(s) and % active counsellor(s).',
      v_coordinators, v_counsellors;
  END IF;
  SELECT id INTO v_coordinator FROM public.profiles WHERE role = 'coordinator' AND is_active;
  SELECT id INTO v_counsellor FROM public.profiles WHERE role = 'counsellor' AND is_active;

  PERFORM pg_advisory_xact_lock(hashtextextended('coordinator-round-robin', 0));

  -- Every existing client (phone) gets the coordinator, with all their purchases and tries.
  WITH phones AS (
    SELECT phone FROM public.purchases
    UNION
    SELECT phone FROM public.clients WHERE phone ~ '^\+[0-9]{8,15}$'
  ), put AS (
    INSERT INTO public.client_coordinators (phone, coordinator_id, assigned_at)
    SELECT phone, v_coordinator, now() FROM phones
    ON CONFLICT (phone) DO UPDATE SET coordinator_id = EXCLUDED.coordinator_id, assigned_at = EXCLUDED.assigned_at
      WHERE public.client_coordinators.coordinator_id IS DISTINCT FROM EXCLUDED.coordinator_id
    RETURNING 1
  )
  SELECT count(*) INTO n_phones FROM put;
  WITH put AS (
    UPDATE public.purchases SET coordinator_id = v_coordinator
    WHERE coordinator_id IS DISTINCT FROM v_coordinator
    RETURNING 1
  )
  SELECT count(*) INTO n_purchases FROM put;
  INSERT INTO public.coordinator_round_robin (profile_id, last_assigned_at) VALUES (v_coordinator, clock_timestamp())
  ON CONFLICT (profile_id) DO UPDATE SET last_assigned_at = EXCLUDED.last_assigned_at;

  -- Every existing client with a paid assessment is assigned to the counsellor (keeps seeing their reports).
  WITH put AS (
    INSERT INTO public.client_counsellors (client_id, counsellor_id, at_go_live)
    SELECT DISTINCT pu.client_id, v_counsellor, true
    FROM public.purchases pu
    WHERE pu.kind = 'assessment' AND pu.status = 'paid' AND pu.client_id IS NOT NULL
    ON CONFLICT (client_id, counsellor_id) WHERE ended_at IS NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_clients FROM put;

  RETURN jsonb_build_object(
    'coordinator', (SELECT full_name FROM public.profiles WHERE id = v_coordinator),
    'counsellor', (SELECT full_name FROM public.profiles WHERE id = v_counsellor),
    'phones', n_phones, 'purchases', n_purchases, 'clients_to_counsellor', n_clients);
END;
$$;

-- 5. Who may call -----------------------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.presentation_mark_done_admin(uuid, uuid, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.go_live_assign_old_clients() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.presentation_mark_done_admin(uuid, uuid, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.go_live_assign_old_clients() TO service_role;

COMMIT;

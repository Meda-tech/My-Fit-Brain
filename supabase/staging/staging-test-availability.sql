-- STAGING ONLY. Behaviour test for step 3 (counsellor availability).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-availability.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

-- A Monday and a Sunday well in the future (the test must not depend on today).
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin,
       (SELECT id FROM public.profiles WHERE email = 'counsellor@example.com') AS counsellor,
       (SELECT id FROM public.profiles WHERE email = 'coordinator@example.com') AS coordinator,
       date '2030-01-07' AS monday, date '2030-01-06' AS sunday;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;

SELECT 'default Monday: 17 free slots (9:00 … 12:30, 13:30 … 17:30); Sunday: none',
  (SELECT count(*) = 17 AND bool_and(state = 'free') FROM t, public.counsellor_slots(t.counsellor, t.monday, t.monday))
  AND (SELECT count(*) = 0 FROM t, public.counsellor_slots(t.counsellor, t.sunday, t.sunday));

-- Mark off a range.
CREATE TEMP TABLE t_off ON COMMIT DROP AS
SELECT public.availability_add(counsellor, 'off', monday, '14:00', '16:00', 'Training', admin) AS id FROM t;
SELECT 'Mark off 14:00–16:00: those 4 slots are off, 13 stay free; who and why are kept',
  (SELECT count(*) FILTER (WHERE state = 'off') = 4 AND count(*) FILTER (WHERE state = 'free') = 13
   FROM t, public.counsellor_slots(t.counsellor, t.monday, t.monday))
  AND (SELECT reason = 'Training' AND created_by_name = 'Test Super Admin' FROM public.availability_changes WHERE id = (SELECT id FROM t_off));

-- Whole day off.
SELECT public.availability_add(counsellor, 'off', monday + 1, null, null, null, admin) IS NOT NULL AS added FROM t;
SELECT 'Mark off the whole day: all 17 slots off; marking it off again is refused',
  (SELECT count(*) = 17 AND bool_and(state = 'off') FROM t, public.counsellor_slots(t.counsellor, t.monday + 1, t.monday + 1))
  AND pg_temp.fails_with(format('SELECT public.availability_add(%L, ''off'', %L, null, null, null, %L)',
                                (SELECT counsellor FROM t), (SELECT monday + 1 FROM t), (SELECT admin FROM t)),
                         'This day is already off.');

-- Custom slots.
SELECT public.availability_add(counsellor, 'custom', sunday, '10:00', '12:00', 'ignored', admin) IS NOT NULL AS added FROM t;
SELECT public.availability_add(counsellor, 'custom', monday, '18:00', '18:30', null, admin) IS NOT NULL AS added FROM t;
SELECT 'custom slots: Sunday 10:00–12:00 = 4 free slots; Monday 18:00–18:30 adds one (18 that day: 13 free, 4 off, 1 custom)',
  (SELECT count(*) = 4 AND bool_and(state = 'free' AND custom_change IS NOT NULL) FROM t, public.counsellor_slots(t.counsellor, t.sunday, t.sunday))
  AND (SELECT count(*) = 18 AND bool_or(start_time = '18:00' AND end_time = '18:30') FROM t, public.counsellor_slots(t.counsellor, t.monday, t.monday))
  AND (SELECT reason IS NULL FROM public.availability_changes WHERE kind = 'custom' AND on_date = (SELECT sunday FROM t) AND counsellor_id = (SELECT counsellor FROM t));
SELECT 'custom range not a whole number of slots, or overlapping custom slots, or in the past, is refused',
  pg_temp.fails_with(format('SELECT public.availability_add(%L, ''custom'', %L, ''18:30'', ''18:45'', null, %L)',
                            (SELECT counsellor FROM t), (SELECT monday FROM t), (SELECT admin FROM t)),
                     'The time range must be a whole number of 30-minute slots.')
  AND pg_temp.fails_with(format('SELECT public.availability_add(%L, ''custom'', %L, ''11:00'', ''11:30'', null, %L)',
                                (SELECT counsellor FROM t), (SELECT sunday FROM t), (SELECT admin FROM t)),
                         'Custom slots already cover part of this time.')
  AND pg_temp.fails_with(format('SELECT public.availability_add(%L, ''off'', %L, null, null, null, %L)',
                                (SELECT counsellor FROM t), date '2020-01-06', (SELECT admin FROM t)),
                         'Pick today or a later date.');

-- Only super admins.
SELECT 'a coordinator or a counsellor cannot change availability',
  pg_temp.fails_with(format('SELECT public.availability_add(%L, ''off'', %L, null, null, null, %L)',
                            (SELECT counsellor FROM t), (SELECT monday + 2 FROM t), (SELECT coordinator FROM t)),
                     'Only super admins can change availability.')
  AND pg_temp.fails_with(format('SELECT public.availability_remove(%L, %L)', (SELECT id FROM t_off), (SELECT counsellor FROM t)),
                         'Only super admins can change availability.');

-- Undo.
SELECT public.availability_remove((SELECT id FROM t_off), (SELECT admin FROM t))::text = '' AS undone;
SELECT 'Undo Mark off: the slots are free again; the row stays with who undid it; undo twice is refused',
  (SELECT count(*) FILTER (WHERE state = 'off') = 0 FROM t, public.counsellor_slots(t.counsellor, t.monday, t.monday))
  AND (SELECT removed_at IS NOT NULL AND removed_by_name = 'Test Super Admin' FROM public.availability_changes WHERE id = (SELECT id FROM t_off))
  AND pg_temp.fails_with(format('SELECT public.availability_remove(%L, %L)', (SELECT id FROM t_off), (SELECT admin FROM t)),
                         'This change was already undone.');
SELECT 'history is never deleted or rewritten',
  pg_temp.fails_with(format('DELETE FROM public.availability_changes WHERE id = %L', (SELECT id FROM t_off)),
                     'Availability history is never removed.')
  AND pg_temp.fails_with(format('UPDATE public.availability_changes SET reason = ''x'' WHERE id = %L', (SELECT id FROM t_off)),
                         'An availability change can only be undone, once.');

-- Access: only super admins read availability.
SELECT 'as coordinator', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'coordinator@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'coordinator: reads no availability', (SELECT count(*) = 0 FROM public.availability_changes) AND (SELECT count(*) = 0 FROM public.availability_settings);
RESET ROLE;

ROLLBACK;

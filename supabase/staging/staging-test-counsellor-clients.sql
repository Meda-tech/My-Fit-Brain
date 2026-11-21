-- STAGING ONLY. Behaviour test for counsellor access and Move clients (20261121600000_counsellor_clients.sql).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-counsellor-clients.sql
-- Uses counsellor@example.com (c1) and counsellor2@example.com (c2), both active.

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin,
       (SELECT id FROM public.profiles WHERE email = 'counsellor@example.com') AS c1,
       (SELECT id FROM public.profiles WHERE email = 'counsellor2@example.com') AS c2,
       public.booking_last_day() AS day;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;
-- Run as a signed-in staff member (email), then back.
CREATE FUNCTION pg_temp.login(p_email text) RETURNS boolean LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = p_email), 'role', 'authenticated')::text, true) IS NOT NULL;
$$;

-- Two clients A and B, each paid (manual) with a completed assessment.
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status) VALUES
  ('5eed0000-0000-4000-8000-0000000e00c1', '+919999900081', 'Access Test A', 'Female', 30, 'Single'),
  ('5eed0000-0000-4000-8000-0000000e00c2', '+919999900082', 'Access Test B', 'Male', 32, 'Single');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
SELECT v.id, v.phone, 'IA', 'offline', 350000, 'paid', 'offline_' || v.id, 'offline_' || v.id, now(), 'upi', 'UPI-ACC-' || v.n, admin,
       'fake-proof-a' || v.n, 'https://drive.example/fake-proof-a' || v.n, v.client, now()
FROM t, (VALUES ('5eed0000-0000-4000-8000-0000000e0001'::uuid, '+919999900081', 1, '5eed0000-0000-4000-8000-0000000e00c1'::uuid),
                ('5eed0000-0000-4000-8000-0000000e0002'::uuid, '+919999900082', 2, '5eed0000-0000-4000-8000-0000000e00c2'::uuid)) AS v(id, phone, n, client);
SELECT public.create_paid_attempt(v.client, 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), 'offline_' || v.pay, now(), 'en') IS NOT NULL AS attempt
FROM (VALUES ('5eed0000-0000-4000-8000-0000000e00c1'::uuid, '5eed0000-0000-4000-8000-0000000e0001'),
             ('5eed0000-0000-4000-8000-0000000e00c2'::uuid, '5eed0000-0000-4000-8000-0000000e0002')) AS v(client, pay);
UPDATE public.payments p SET attempt_id = a.id FROM public.attempts a
WHERE a.payment_ref = 'offline_' || p.id AND p.id IN ('5eed0000-0000-4000-8000-0000000e0001', '5eed0000-0000-4000-8000-0000000e0002')
  AND p.attempt_id IS NULL;
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now()
WHERE client_id IN ('5eed0000-0000-4000-8000-0000000e00c1', '5eed0000-0000-4000-8000-0000000e00c2');
UPDATE public.attempts SET status = 'completed', completed_at = now()
WHERE client_id IN ('5eed0000-0000-4000-8000-0000000e00c1', '5eed0000-0000-4000-8000-0000000e00c2');
CREATE TEMP TABLE t_p ON COMMIT DROP AS
SELECT (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000e0001') AS pa,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000e0002') AS pb;

-- 1. A booking assigns the client to the counsellor.
SELECT public.presentation_book((SELECT pa FROM t_p), c1, day, '10:00', admin) IS NOT NULL AS booked_a_with_c1 FROM t;
SELECT 'booking A with c1 assigns A to c1; B (not booked) is nobody''s',
  EXISTS (SELECT 1 FROM public.client_counsellors, t WHERE client_id = '5eed0000-0000-4000-8000-0000000e00c1' AND counsellor_id = t.c1 AND ended_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.client_counsellors WHERE client_id = '5eed0000-0000-4000-8000-0000000e00c2');

SELECT pg_temp.login('counsellor@example.com') AS as_c1;
SET LOCAL ROLE authenticated;
SELECT 'c1 sees client A and A''s assessment; not B, not B''s assessment',
  EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000000e00c1')
  AND EXISTS (SELECT 1 FROM public.attempts WHERE client_id = '5eed0000-0000-4000-8000-0000000e00c1')
  AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000000e00c2')
  AND NOT EXISTS (SELECT 1 FROM public.attempts WHERE client_id = '5eed0000-0000-4000-8000-0000000e00c2');
RESET ROLE;

SELECT pg_temp.login('counsellor2@example.com') AS as_c2;
SET LOCAL ROLE authenticated;
SELECT 'c2 (no bookings) sees no clients, assessments, answers, results, details, alerts or conclusions',
  (SELECT count(*) = 0 FROM public.clients) AND (SELECT count(*) = 0 FROM public.attempts)
  AND (SELECT count(*) = 0 FROM public.attempt_answers) AND (SELECT count(*) = 0 FROM public.attempt_results)
  AND (SELECT count(*) = 0 FROM public.attempt_details) AND (SELECT count(*) = 0 FROM public.attempt_alerts)
  AND (SELECT count(*) = 0 FROM public.attempt_conclusions);
RESET ROLE;

SELECT pg_temp.login('superadmin@example.com') AS as_admin;
SET LOCAL ROLE authenticated;
SELECT 'super admin still sees both clients',
  (SELECT count(*) = 2 FROM public.clients WHERE id IN ('5eed0000-0000-4000-8000-0000000e00c1', '5eed0000-0000-4000-8000-0000000e00c2'));
RESET ROLE;

SELECT pg_temp.login('coordinator@example.com') AS as_coordinator;
SET LOCAL ROLE authenticated;
SELECT 'a coordinator sees what they saw before (both clients)',
  (SELECT count(*) = 2 FROM public.clients WHERE id IN ('5eed0000-0000-4000-8000-0000000e00c1', '5eed0000-0000-4000-8000-0000000e00c2'));
RESET ROLE;

-- 2. Make inactive is refused while c1 has clients.
SELECT 'c1 cannot be made inactive: Move their clients first.',
  pg_temp.fails_with(format('UPDATE public.profiles SET is_active = false WHERE id = %L', (SELECT c1 FROM t)), 'Move their clients first.');

-- 3. A clashing move is refused and moves nothing. c2 gets B booked at the same time as A.
SELECT public.presentation_book((SELECT pb FROM t_p), c2, day, '10:00', admin) IS NOT NULL AS booked_b_with_c2 FROM t;
SELECT 'the clash list names A''s presentation',
  (SELECT count(*) = 1 AND bool_and(client_name = 'Access Test A' AND start_time = '10:00')
   FROM t, public.counsellor_move_clashes(t.c1, t.c2));
SELECT 'the clashing move is refused',
  pg_temp.fails_with(format('SELECT public.move_counsellor_clients(%L, %L, %L)', (SELECT c1 FROM t), (SELECT c2 FROM t), (SELECT admin FROM t)),
                     'The new counsellor is not free at some of these times. Pick another counsellor.');
SELECT 'nothing moved: A''s booking still with c1, A still assigned to c1, no move logged',
  (SELECT counsellor_id = t.c1 FROM public.presentation_bookings, t WHERE purchase_id = (SELECT pa FROM t_p) AND status = 'booked')
  AND EXISTS (SELECT 1 FROM public.client_counsellors, t WHERE client_id = '5eed0000-0000-4000-8000-0000000e00c1' AND counsellor_id = t.c1 AND ended_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.counsellor_client_moves, t WHERE from_counsellor_id = t.c1);

-- 4. B's booking is cancelled (B stays assigned to c2: no special handling); now c2 is free at 10:00.
SELECT public.presentation_cancel((SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT pb FROM t_p) AND status = 'booked'),
                                  'Test: free the slot', (SELECT admin FROM t))::text = '' AS cancelled_b;
SELECT 'a cancelled booking keeps the assignment (B with c2)',
  EXISTS (SELECT 1 FROM public.client_counsellors, t WHERE client_id = '5eed0000-0000-4000-8000-0000000e00c2' AND counsellor_id = t.c2 AND ended_at IS NULL);

CREATE TEMP TABLE t_past ON COMMIT DROP AS
SELECT id FROM public.presentation_bookings, t
WHERE counsellor_id = t.c1 AND (on_date + start_time) AT TIME ZONE 'Asia/Kolkata' <= now();
CREATE TEMP TABLE t_move ON COMMIT DROP AS
SELECT public.move_counsellor_clients(c1, c2, admin) AS result FROM t;
SELECT 'move: A''s upcoming presentation goes to c2 at the same date and time',
  (SELECT (result ->> 'presentations')::int >= 1 FROM t_move)
  AND (SELECT counsellor_id = t.c2 AND on_date = t.day AND start_time = '10:00' AND status = 'booked'
       FROM public.presentation_bookings, t WHERE purchase_id = (SELECT pa FROM t_p) AND status = 'booked');
SELECT 'move: c1''s assignments ended, c2 has A; past presentations keep c1',
  NOT EXISTS (SELECT 1 FROM public.client_counsellors, t WHERE counsellor_id = t.c1 AND ended_at IS NULL)
  AND EXISTS (SELECT 1 FROM public.client_counsellors, t WHERE client_id = '5eed0000-0000-4000-8000-0000000e00c1' AND counsellor_id = t.c2 AND ended_at IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.presentation_bookings b, t WHERE b.id IN (SELECT id FROM t_past) AND b.counsellor_id <> t.c1);
SELECT 'move logged: from, to, who, when, which clients and presentations',
  EXISTS (SELECT 1 FROM public.counsellor_client_moves m, t
          WHERE m.from_counsellor_id = t.c1 AND m.to_counsellor_id = t.c2 AND m.moved_by = t.admin AND m.moved_by_name = 'Test Super Admin'
            AND m.moved_at = now() AND '5eed0000-0000-4000-8000-0000000e00c1' = ANY (m.client_ids)
            AND (SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT pa FROM t_p) AND status = 'booked') = ANY (m.booking_ids));

SELECT pg_temp.login('counsellor@example.com') AS as_c1_again;
SET LOCAL ROLE authenticated;
SELECT 'after the move c1 sees no clients', (SELECT count(*) = 0 FROM public.clients) AND (SELECT count(*) = 0 FROM public.attempts);
RESET ROLE;
SELECT pg_temp.login('counsellor2@example.com') AS as_c2_again;
SET LOCAL ROLE authenticated;
SELECT 'after the move c2 sees A (moved) and B (its own cancelled booking)',
  (SELECT count(*) = 2 FROM public.clients WHERE id IN ('5eed0000-0000-4000-8000-0000000e00c1', '5eed0000-0000-4000-8000-0000000e00c2'));
RESET ROLE;

-- 5. Now c1 can be made inactive; an inactive counsellor gets no bookings and sees nothing.
UPDATE public.profiles SET is_active = false WHERE id = (SELECT c1 FROM t);
SELECT 'c1 inactive', (SELECT NOT is_active FROM public.profiles, t WHERE id = t.c1);
SELECT 'an inactive counsellor gets no new bookings and is never offered',
  pg_temp.fails_with(format('SELECT public.presentation_book(%L, %L, %L, ''11:00'', %L)',
                            (SELECT pb FROM t_p), (SELECT c1 FROM t), (SELECT day FROM t), (SELECT admin FROM t)),
                     'Choose an active counsellor.')
  AND NOT EXISTS (SELECT 1 FROM t, public.free_presentation_slots(current_date, current_date + 29) f WHERE f.counsellor_id = t.c1);
SELECT 'assignments and moves are never removed',
  pg_temp.fails_with('DELETE FROM public.client_counsellors', 'Assignments are never removed.')
  AND pg_temp.fails_with('DELETE FROM public.counsellor_client_moves', 'Moves are never changed or removed.');

ROLLBACK;

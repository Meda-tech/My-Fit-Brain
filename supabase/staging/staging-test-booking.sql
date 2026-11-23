-- STAGING ONLY. Behaviour test for step 4 (Booking call, Book presentation, Cancel booking).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-booking.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

-- The last day the window allows (the 3rd working day; a normal work day, 2+ days ahead), 10:00. Named "monday" from before.
CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin,
       (SELECT id FROM public.profiles WHERE email = 'counsellor@example.com') AS counsellor,
       public.booking_last_day() AS monday;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;
CREATE FUNCTION pg_temp.fails(p_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END;
$$;

-- Two paid purchases (manual payments), each with a client; the first one's assessment gets completed.
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status) VALUES
  ('5eed0000-0000-4000-8000-0000000d00c1', '+919999900071', 'Booking Test', 'Female', 30, 'Single'),
  ('5eed0000-0000-4000-8000-0000000d00c2', '+919999900072', 'Booking Two', 'Male', 32, 'Single');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
SELECT v.id, v.phone, 'IA', 'offline', 350000, 'paid', 'offline_' || v.id, 'offline_' || v.id, now(), 'upi', 'UPI-BOOK-' || v.n, admin,
       'fake-proof-b' || v.n, 'https://drive.example/fake-proof-b' || v.n, v.client, now()
FROM t, (VALUES ('5eed0000-0000-4000-8000-0000000d0001'::uuid, '+919999900071', 1, '5eed0000-0000-4000-8000-0000000d00c1'::uuid),
                ('5eed0000-0000-4000-8000-0000000d0002'::uuid, '+919999900072', 2, '5eed0000-0000-4000-8000-0000000d00c2'::uuid)) AS v(id, phone, n, client);
CREATE TEMP TABLE t_p ON COMMIT DROP AS
SELECT (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000d0001') AS p1,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000d0002') AS p2;

SELECT 'paid, assessment not completed: no Booking call yet',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p1 FROM t_p) AND kind = 'booking');
SELECT 'booking before the assessment is completed is refused',
  pg_temp.fails_with(format('SELECT public.presentation_book(%L, %L, %L, ''10:00'', %L)',
                            (SELECT p1 FROM t_p), (SELECT counsellor FROM t), (SELECT monday FROM t), (SELECT admin FROM t)),
                     'The assessment is not completed yet.');

CREATE TEMP TABLE t_attempt ON COMMIT DROP AS
SELECT public.create_paid_attempt('5eed0000-0000-4000-8000-0000000d00c1', 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'),
  'offline_5eed0000-0000-4000-8000-0000000d0001', now(), 'en') AS result;
UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = 'offline_5eed0000-0000-4000-8000-0000000d0001')
WHERE id = '5eed0000-0000-4000-8000-0000000d0001' AND attempt_id IS NULL;
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = 'offline_5eed0000-0000-4000-8000-0000000d0001';
UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = 'offline_5eed0000-0000-4000-8000-0000000d0001';

SELECT 'assessment completed: Booking call open, due 2 working hours after completion; journey planned = that due time',
  (SELECT c.status = 'open' AND c.created_at = now() AND c.due_at = public.add_working_hours(now(), 2) AND s.planned_at = c.due_at
   FROM public.calls c JOIN public.purchase_stages s ON s.purchase_id = c.purchase_id AND s.stage = 'presentation_booking'
   WHERE c.purchase_id = (SELECT p1 FROM t_p) AND c.kind = 'booking');
SELECT 'Mark as call done works on the Booking call (Not interested still needs at least 2 calls)',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', ''not_now'', null, null)',
                            (SELECT id FROM public.calls WHERE purchase_id = (SELECT p1 FROM t_p) AND kind = 'booking'), (SELECT admin FROM t)),
                     'At least 2 calls are needed first.');

-- Book: only this client's coordinator or a super admin.
SELECT 'a coordinator who is not this client''s coordinator cannot book',
  pg_temp.fails_with(format('SELECT public.presentation_book(%L, %L, %L, ''10:00'', %L)',
                            (SELECT p1 FROM t_p), (SELECT counsellor FROM t), (SELECT monday FROM t),
                            (SELECT id FROM public.profiles WHERE role = 'coordinator' AND is_active
                               AND id IS DISTINCT FROM (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p1 FROM t_p)) LIMIT 1)),
                     'Only this client''s coordinator can book their presentation.');
SELECT public.presentation_book((SELECT p1 FROM t_p), counsellor, monday, '10:00',
                                (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p1 FROM t_p))) IS NOT NULL AS booked
FROM t;

SELECT 'booked: the slot is Booked for everyone; it is no longer offered as free',
  (SELECT state = 'booked' FROM t, public.counsellor_slots(t.counsellor, t.monday, t.monday) s WHERE s.start_time = '10:00')
  AND NOT EXISTS (SELECT 1 FROM t, public.free_presentation_slots(t.monday, t.monday) f
                  WHERE f.counsellor_id = t.counsellor AND f.start_time = '10:00');
SELECT 'journey: Presentation booking actual = booked at, Report presentation planned = the slot',
  (SELECT done_at = now() FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM t_p) AND stage = 'presentation_booking')
  AND (SELECT planned_at = (t.monday + time '10:00') AT TIME ZONE 'Asia/Kolkata' AND status = 'open'
       FROM public.purchase_stages, t WHERE purchase_id = (SELECT p1 FROM t_p) AND stage = 'report_presentation');
SELECT 'the Booking call closed by itself with "Presentation booked: <counsellor>, <date time>"',
  (SELECT status = 'closed' AND outcome = 'booked' FROM public.calls WHERE purchase_id = (SELECT p1 FROM t_p) AND kind = 'booking')
  AND EXISTS (SELECT 1 FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
              WHERE c.purchase_id = (SELECT p1 FROM t_p) AND l.event = 'presentation_booked'
                AND l.note = 'Test Counsellor, ' || public.presentation_label((SELECT monday FROM t), '10:00'));

-- Double booking is refused.
UPDATE public.purchase_stages SET done_at = now() WHERE purchase_id = (SELECT p2 FROM t_p) AND stage = 'assessment';
SELECT 'another purchase cannot take the same slot; the same purchase cannot book twice',
  pg_temp.fails_with(format('SELECT public.presentation_book(%L, %L, %L, ''10:00'', %L)',
                            (SELECT p2 FROM t_p), (SELECT counsellor FROM t), (SELECT monday FROM t), (SELECT admin FROM t)),
                     'This slot is no longer free. Pick another.')
  AND pg_temp.fails_with(format('SELECT public.presentation_book(%L, %L, %L, ''11:00'', %L)',
                                (SELECT p1 FROM t_p), (SELECT counsellor FROM t), (SELECT monday FROM t), (SELECT admin FROM t)),
                         'A presentation is already booked for this purchase.');
SELECT 'even writing straight into the table, the database refuses a second booking of the slot',
  pg_temp.fails(format('INSERT INTO public.presentation_bookings (purchase_id, counsellor_id, on_date, start_time, end_time) VALUES (%L, %L, %L, ''10:00'', ''10:30'')',
                       (SELECT p2 FROM t_p), (SELECT counsellor FROM t), (SELECT monday FROM t)));
SELECT 'only the next 3 working days: a later date is refused and never listed',
  pg_temp.fails_with(format('SELECT public.presentation_book(%L, %L, %L, ''10:00'', %L)',
                            (SELECT p2 FROM t_p), (SELECT counsellor FROM t), (SELECT monday FROM t) + 7, (SELECT admin FROM t)),
                     'Pick a slot in the next 3 working days.')
  AND NOT EXISTS (SELECT 1 FROM public.free_presentation_slots(current_date, current_date + 29) f WHERE f.on_date > (SELECT monday FROM t));
SELECT 'Mark off over a booked slot is refused',
  pg_temp.fails_with(format('SELECT public.availability_add(%L, ''off'', %L, null, null, null, %L)',
                            (SELECT counsellor FROM t), (SELECT monday FROM t), (SELECT admin FROM t)),
                     'Some of these slots are booked. Move those bookings first.');

-- Cancel booking: super admins only, reason required.
CREATE TEMP TABLE t_b ON COMMIT DROP AS
SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT p1 FROM t_p) AND status = 'booked';
SELECT 'only super admins cancel, and only with a reason',
  pg_temp.fails_with(format('SELECT public.presentation_cancel(%L, ''Wrong slot'', %L)', (SELECT id FROM t_b),
                            (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p1 FROM t_p))),
                     'Only super admins can cancel a booking.')
  AND pg_temp.fails_with(format('SELECT public.presentation_cancel(%L, '' '', %L)', (SELECT id FROM t_b), (SELECT admin FROM t)),
                         'Write the reason (3 to 300 characters).');
SELECT public.presentation_cancel((SELECT id FROM t_b), 'Booked the wrong counsellor', (SELECT admin FROM t))::text = '' AS cancelled;
SELECT 'cancelled: the row stays with who and why; the slot is free again; the journey is back at Presentation booking',
  (SELECT status = 'cancelled' AND cancelled_by_name = 'Test Super Admin' AND cancel_reason = 'Booked the wrong counsellor'
   FROM public.presentation_bookings WHERE id = (SELECT id FROM t_b))
  AND (SELECT state = 'free' FROM t, public.counsellor_slots(t.counsellor, t.monday, t.monday) s WHERE s.start_time = '10:00')
  AND (SELECT done_at IS NULL AND status = 'open' FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM t_p) AND stage = 'presentation_booking')
  AND (SELECT planned_at IS NULL FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM t_p) AND stage = 'report_presentation');
SELECT 'cancelled: the Booking call reopens, due 2 working hours from now, with a history line',
  (SELECT status = 'open' AND due_at = public.add_working_hours(now(), 2) FROM public.calls WHERE purchase_id = (SELECT p1 FROM t_p) AND kind = 'booking')
  AND EXISTS (SELECT 1 FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
              WHERE c.purchase_id = (SELECT p1 FROM t_p) AND l.event = 'booking_cancelled' AND l.note LIKE '%Booked the wrong counsellor');
SELECT 'a booking is never deleted',
  pg_temp.fails_with(format('DELETE FROM public.presentation_bookings WHERE id = %L', (SELECT id FROM t_b)), 'Bookings are never removed.');
SELECT 'the freed slot can be booked again (by another purchase)',
  public.presentation_book((SELECT p2 FROM t_p), (SELECT counsellor FROM t), (SELECT monday FROM t), '10:00', (SELECT admin FROM t)) IS NOT NULL;

-- Access: a coordinator sees only their clients' bookings; a counsellor none (for now).
SELECT 'as counsellor', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'counsellor@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'counsellor: reads no bookings', (SELECT count(*) = 0 FROM public.presentation_bookings);
RESET ROLE;

ROLLBACK;

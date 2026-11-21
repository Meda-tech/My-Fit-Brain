-- STAGING ONLY. Behaviour test for step 5 (Report presentation done → Package call).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-presentation.sql

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
       (SELECT id FROM public.profiles WHERE email = 'counsellor@example.com') AS counsellor,
       (SELECT id FROM public.profiles WHERE email = 'counsellor2@example.com') AS other_counsellor,
       current_date + ((8 - extract(isodow FROM current_date)::int) % 7) + 7 AS monday;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;

-- A paid purchase with a completed assessment and a presentation booked on a future Monday at 11:00.
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
VALUES ('5eed0000-0000-4000-8000-0000000e00c1', '+919999900061', 'Presentation Test', 'Female', 30, 'Single');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
SELECT '5eed0000-0000-4000-8000-0000000e0001', '+919999900061', 'IA', 'offline', 350000, 'paid', 'offline_e1', 'offline_e1', now(), 'upi', 'UPI-PRES-1', admin,
       'fake-proof-p1', 'https://drive.example/fake-proof-p1', '5eed0000-0000-4000-8000-0000000e00c1', now()
FROM t;
CREATE TEMP TABLE t_p ON COMMIT DROP AS
SELECT purchase_id AS id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000e0001';
SELECT public.create_paid_attempt('5eed0000-0000-4000-8000-0000000e00c1', 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), 'offline_e1', now(), 'en') IS NOT NULL AS started;
UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = 'offline_e1')
WHERE id = '5eed0000-0000-4000-8000-0000000e0001' AND attempt_id IS NULL;
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = 'offline_e1';
UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = 'offline_e1';
SELECT public.presentation_book((SELECT id FROM t_p), counsellor, monday, '11:00', admin) IS NOT NULL AS booked FROM t;
CREATE TEMP TABLE t_b ON COMMIT DROP AS
SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT id FROM t_p) AND status = 'booked';

-- Who and when.
SELECT 'the counsellor cannot mark it done before the slot starts; another counsellor or a coordinator never',
  pg_temp.fails_with(format('SELECT public.presentation_mark_done(%L, %L)', (SELECT id FROM t_b), (SELECT counsellor FROM t)),
                     'It can be marked done from the start of the slot.')
  AND pg_temp.fails_with(format('SELECT public.presentation_mark_done(%L, %L)', (SELECT id FROM t_b), (SELECT other_counsellor FROM t)),
                         'Only the counsellor of this presentation can mark it done.')
  AND pg_temp.fails_with(format('SELECT public.presentation_mark_done(%L, %L)', (SELECT id FROM t_b),
                                (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT id FROM t_p))),
                         'Only the counsellor or a super admin can mark the presentation done.');
SELECT 'no Package call before the presentation is marked done',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT id FROM t_p) AND kind = 'package');

-- From the slot start the counsellor can (the slot is moved into the past here, inside this rolled-back test).
ALTER TABLE public.presentation_bookings DISABLE TRIGGER presentation_bookings_keep;
UPDATE public.presentation_bookings SET on_date = current_date - 1 WHERE id = (SELECT id FROM t_b);
ALTER TABLE public.presentation_bookings ENABLE TRIGGER presentation_bookings_keep;
SELECT public.presentation_mark_done((SELECT id FROM t_b), (SELECT counsellor FROM t))::text = '' AS marked;

SELECT 'marked done: who and when kept; journey Report presentation actual = now; Package call planned = due',
  (SELECT done_at = now() AND done_by_name = 'Test Counsellor' FROM public.presentation_bookings WHERE id = (SELECT id FROM t_b))
  AND (SELECT done_at = now() FROM public.purchase_stages WHERE purchase_id = (SELECT id FROM t_p) AND stage = 'report_presentation')
  AND (SELECT planned_at = public.add_working_hours(now(), 2) AND status = 'open'
       FROM public.purchase_stages WHERE purchase_id = (SELECT id FROM t_p) AND stage = 'package_call');
SELECT 'Package call open for the client''s coordinator, due 2 working hours after the marking',
  (SELECT status = 'open' AND created_at = now() AND due_at = public.add_working_hours(now(), 2)
   FROM public.calls WHERE purchase_id = (SELECT id FROM t_p) AND kind = 'package');
SELECT 'marking twice, or cancelling after done, is refused',
  pg_temp.fails_with(format('SELECT public.presentation_mark_done(%L, %L)', (SELECT id FROM t_b), (SELECT admin FROM t)),
                     'This presentation is already marked done.')
  AND pg_temp.fails_with(format('SELECT public.presentation_cancel(%L, ''Mistake'', %L)', (SELECT id FROM t_b), (SELECT admin FROM t)),
                         'This presentation was already marked done. It cannot be cancelled.');

-- Package call: same Mark as call done rules; Done (Client agreed) fills the actual time.
CREATE TEMP TABLE t_c ON COMMIT DROP AS
SELECT id FROM public.calls WHERE purchase_id = (SELECT id FROM t_p) AND kind = 'package';
SELECT 'Not interested on the first Package call is refused',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', ''too_costly'', null, null)', (SELECT id FROM t_c), (SELECT admin FROM t)),
                     'At least one follow-up call is needed first.');
SELECT public.call_mark((SELECT id FROM t_c), (SELECT admin FROM t), 'call_later', null, 'Thinking about it', now() + interval '1 hour')::text = '' AS marked;
SELECT 'Call later: still open, journey Package call not done yet',
  (SELECT status = 'open' FROM public.calls WHERE id = (SELECT id FROM t_c))
  AND (SELECT done_at IS NULL FROM public.purchase_stages WHERE purchase_id = (SELECT id FROM t_p) AND stage = 'package_call');
SELECT public.call_mark((SELECT id FROM t_c), (SELECT admin FROM t), 'done', null, 'Agreed to the 6-session package', null)::text = '' AS marked;
SELECT 'Client agreed (done): call closed; journey Package call actual = closed time; every stage done',
  (SELECT c.status = 'closed' AND c.outcome = 'done' AND s.done_at = c.closed_at
   FROM public.calls c JOIN public.purchase_stages s ON s.purchase_id = c.purchase_id AND s.stage = 'package_call'
   WHERE c.id = (SELECT id FROM t_c))
  AND (SELECT bool_and(status = 'done') FROM public.purchase_stages WHERE purchase_id = (SELECT id FROM t_p));

-- Super admins can mark a future presentation done (to fix a forgotten or early one).
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
VALUES ('5eed0000-0000-4000-8000-0000000e00c2', '+919999900062', 'Presentation Two', 'Male', 31, 'Single');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
SELECT '5eed0000-0000-4000-8000-0000000e0002', '+919999900062', 'IA', 'offline', 350000, 'paid', 'offline_e2', 'offline_e2', now(), 'upi', 'UPI-PRES-2', admin,
       'fake-proof-p2', 'https://drive.example/fake-proof-p2', '5eed0000-0000-4000-8000-0000000e00c2', now()
FROM t;
SELECT public.create_paid_attempt('5eed0000-0000-4000-8000-0000000e00c2', 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), 'offline_e2', now(), 'en') IS NOT NULL AS started;
UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = 'offline_e2')
WHERE id = '5eed0000-0000-4000-8000-0000000e0002' AND attempt_id IS NULL;
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = 'offline_e2';
UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = 'offline_e2';
SELECT public.presentation_book((SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000e0002'),
                                counsellor, monday, '12:00', admin) IS NOT NULL AS booked FROM t;
SELECT 'a super admin can mark it done at any time (before the slot too)',
  public.presentation_mark_done((SELECT id FROM public.presentation_bookings b WHERE b.status = 'booked'
                                   AND b.purchase_id = (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000e0002')),
                                (SELECT admin FROM t))::text = '';

ROLLBACK;

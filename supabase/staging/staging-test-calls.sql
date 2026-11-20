-- STAGING ONLY. Behaviour test for step 2 (Payment and Assessment calls, Mark as call done).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-calls.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE TEMP TABLE t_ids ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin;

-- Expects p_sql to fail with exactly p_message.
CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;

-- 1. A failed try: Payment call at once, due 2 working hours later.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000c0001', '+919999900081', 'IA', 'razorpay', 350000, 'failed', 'order_STAGINGFAKE_C1');
CREATE TEMP TABLE t_a1 ON COMMIT DROP AS
SELECT purchase_id AS id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000c0001';
SELECT 'failed try: one open Payment call at once, due 2 working hours after it starts, "created" in its history',
  (SELECT count(*) = 1 AND bool_and(status = 'open' AND due_at = public.add_working_hours(created_at, 2))
   FROM public.calls WHERE purchase_id = (SELECT id FROM t_a1) AND kind = 'payment')
  AND EXISTS (SELECT 1 FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
              WHERE c.purchase_id = (SELECT id FROM t_a1) AND l.event = 'created');

INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000c0002', '+919999900081', 'IA', 'razorpay', 350000, 'created', 'order_STAGINGFAKE_C2');
SELECT 'a new try: still one Payment call; its history gets a "new try" line',
  (SELECT count(*) = 1 FROM public.calls WHERE purchase_id = (SELECT id FROM t_a1))
  AND EXISTS (SELECT 1 FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
              WHERE c.purchase_id = (SELECT id FROM t_a1) AND l.event = 'new_try');

-- 2. A try not completed: no call before 30 minutes; at 30 minutes the sync makes it, timed from the try.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, created_at)
VALUES ('5eed0000-0000-4000-8000-0000000c0003', '+919999900082', 'IA', 'razorpay', 350000, 'created', 'order_STAGINGFAKE_C3', now() - interval '10 minutes'),
       ('5eed0000-0000-4000-8000-0000000c0004', '+919999900083', 'MA', 'razorpay', 350000, 'created', 'order_STAGINGFAKE_C4', now() - interval '45 minutes');
SELECT public.calls_sync() >= 0 AS synced;
SELECT 'not completed, 10 minutes old: no call yet',
  NOT EXISTS (SELECT 1 FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id WHERE pu.phone = '+919999900082');
SELECT 'not completed, 45 minutes old: Payment call started 30 minutes after the try',
  (SELECT c.created_at = pu.created_at + interval '30 minutes' AND c.status = 'open'
   FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id WHERE pu.phone = '+919999900083');

-- 3. Mark as call done.
CREATE TEMP TABLE t_c1 ON COMMIT DROP AS
SELECT id FROM public.calls WHERE purchase_id = (SELECT id FROM t_a1) AND kind = 'payment';
SELECT 'Not interested on the first call: "At least one follow-up call is needed first."',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', ''too_costly'', null, null)',
                            (SELECT id FROM t_c1), (SELECT admin FROM t_ids)),
                     'At least one follow-up call is needed first.');
SELECT 'Call later beyond 2 working days is refused',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''call_later'', null, null, %L)',
                            (SELECT id FROM t_c1), (SELECT admin FROM t_ids), now() + interval '10 days'),
                     'Pick a follow-up date and time within 2 working days.');
SELECT 'Call later without a time is refused',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_picked'', null, null, null)',
                            (SELECT id FROM t_c1), (SELECT admin FROM t_ids)),
                     'Pick a follow-up date and time within 2 working days.');
SELECT public.call_mark((SELECT id FROM t_c1), (SELECT admin FROM t_ids), 'not_picked', null, 'Rang twice', now() + interval '1 hour')::text = '' AS marked;
SELECT 'Not picked: the call stays open with the follow-up as its new due time; saved in the history with the note and who',
  (SELECT status = 'open' AND due_at = now() + interval '1 hour' FROM public.calls WHERE id = (SELECT id FROM t_c1))
  AND EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT id FROM t_c1) AND choice = 'not_picked'
              AND note = 'Rang twice' AND by_name = 'Test Super Admin' AND follow_up_at = now() + interval '1 hour');
SELECT 'Not interested needs a reason',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', null, null, null)',
                            (SELECT id FROM t_c1), (SELECT admin FROM t_ids)),
                     'Choose a reason.');
SELECT public.call_mark((SELECT id FROM t_c1), (SELECT admin FROM t_ids), 'not_interested', 'too_costly', 'Will think later', null)::text = '' AS marked;
SELECT 'Not interested on a Payment call: call closed, attempt closed as Not interested',
  (SELECT status = 'closed' AND outcome = 'not_interested' FROM public.calls WHERE id = (SELECT id FROM t_c1))
  AND (SELECT closed_reason = 'not_interested' AND closed_at IS NOT NULL AND status = 'not_paid' FROM public.purchases WHERE id = (SELECT id FROM t_a1));
SELECT 'a closed call cannot be marked again',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''done'', null, null, null)', (SELECT id FROM t_c1), (SELECT admin FROM t_ids)),
                     'This call is already closed.');
SELECT 'call history cannot be removed',
  pg_temp.fails_with(format('DELETE FROM public.call_logs WHERE call_id = %L', (SELECT id FROM t_c1)),
                     'Call history is never changed or removed.');

-- 4. Paid: the Payment call closes by itself; the Assessment call starts at the paid time.
CREATE TEMP TABLE t_a4 ON COMMIT DROP AS
SELECT pu.id FROM public.purchases pu WHERE pu.phone = '+919999900083';
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
VALUES ('5eed0000-0000-4000-8000-0000000c00c1', '+919999900083', 'Calls Test', 'Female', 30, 'Single');
UPDATE public.payments SET status = 'paid', provider_payment_id = 'pay_STAGINGFAKE_C4', paid_at = now(),
       client_id = '5eed0000-0000-4000-8000-0000000c00c1', claimed_at = now()
WHERE id = '5eed0000-0000-4000-8000-0000000c0004';
SELECT 'paid: the Payment call closed as paid, with a "paid" line',
  (SELECT status = 'closed' AND outcome = 'paid' FROM public.calls WHERE purchase_id = (SELECT id FROM t_a4) AND kind = 'payment')
  AND EXISTS (SELECT 1 FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
              WHERE c.purchase_id = (SELECT id FROM t_a4) AND c.kind = 'payment' AND l.event = 'paid');
SELECT 'paid: Assessment call open, starts at the paid time, due 2 working hours later; journey planned = that due time',
  (SELECT c.status = 'open' AND c.created_at = pu.paid_at AND c.due_at = public.add_working_hours(pu.paid_at, 2)
          AND s.planned_at = c.due_at
   FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
   JOIN public.purchase_stages s ON s.purchase_id = pu.id AND s.stage = 'assessment'
   WHERE c.purchase_id = (SELECT id FROM t_a4) AND c.kind = 'assessment');

-- 5. Assessment started: still open. Completed: closes by itself.
CREATE TEMP TABLE t_attempt ON COMMIT DROP AS
SELECT public.create_paid_attempt('5eed0000-0000-4000-8000-0000000c00c1', 'MA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'MA' AND status = 'live'),
  'pay_STAGINGFAKE_C4', now(), 'en') AS result;
UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = 'pay_STAGINGFAKE_C4')
WHERE id = '5eed0000-0000-4000-8000-0000000c0004' AND attempt_id IS NULL;
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = 'pay_STAGINGFAKE_C4';
SELECT 'assessment only started: the Assessment call stays open',
  (SELECT status = 'open' FROM public.calls WHERE purchase_id = (SELECT id FROM t_a4) AND kind = 'assessment');
UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = 'pay_STAGINGFAKE_C4';
SELECT 'assessment completed: the Assessment call closed at the completed time, journey actual = completed time',
  (SELECT c.status = 'closed' AND c.outcome = 'assessment_completed' AND c.closed_at = a.completed_at AND s.done_at = a.completed_at
   FROM public.calls c, public.attempts a, public.purchase_stages s
   WHERE c.purchase_id = (SELECT id FROM t_a4) AND c.kind = 'assessment' AND a.payment_ref = 'pay_STAGINGFAKE_C4'
     AND s.purchase_id = c.purchase_id AND s.stage = 'assessment');

-- 6. Done closes the call.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url)
SELECT '5eed0000-0000-4000-8000-0000000c0005', '+919999900084', 'IA', 'offline', 350000, 'paid',
       'offline_5eed0000-0000-4000-8000-0000000c0005', 'offline_5eed0000-0000-4000-8000-0000000c0005', now(), 'upi', 'UPI-CALLS-1', admin, 'fake-proof-c1', 'https://drive.example/fake-proof-c1'
FROM t_ids;
SELECT public.call_mark((SELECT c.id FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
                         WHERE pu.phone = '+919999900084' AND c.kind = 'assessment'),
                        (SELECT admin FROM t_ids), 'done', null, 'Explained the steps', null)::text = '' AS marked;
SELECT 'manual payment with no try: no Payment call; Done closes the Assessment call',
  NOT EXISTS (SELECT 1 FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id WHERE pu.phone = '+919999900084' AND c.kind = 'payment')
  AND (SELECT c.status = 'closed' AND c.outcome = 'done' FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
       WHERE pu.phone = '+919999900084' AND c.kind = 'assessment');

-- 6b. Reopen (owner, 2026-11-20): a new failed try reopens a Payment call closed as Not interested.
-- (In one transaction now() never moves, so the closing time is set an hour back to put the new try after it.)
UPDATE public.calls SET closed_at = now() - interval '1 hour' WHERE id = (SELECT id FROM t_c1);
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000c0006', '+919999900081', 'IA', 'razorpay', 350000, 'failed', 'order_STAGINGFAKE_C6');
SELECT 'Not interested, then a new failed try: same attempt, reopened; same Payment call open again, due 2 working hours after the failure',
  (SELECT purchase_id = (SELECT id FROM t_a1) FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000c0006')
  AND (SELECT closed_at IS NULL AND closed_reason IS NULL FROM public.purchases WHERE id = (SELECT id FROM t_a1))
  AND (SELECT status = 'open' AND outcome IS NULL AND due_at = public.add_working_hours(now(), 2) FROM public.calls WHERE id = (SELECT id FROM t_c1))
  AND (SELECT count(*) = 1 FROM public.calls WHERE purchase_id = (SELECT id FROM t_a1) AND kind = 'payment');
SELECT 'the history has a "Tried again – failed" line (try_failed) after the closing',
  EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT id FROM t_c1) AND event = 'try_failed' AND at > now() - interval '1 hour');

-- 6c. Reopen after Done: a try still unpaid 30 minutes later.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000c0007', '+919999900085', 'MA', 'razorpay', 350000, 'failed', 'order_STAGINGFAKE_C7');
CREATE TEMP TABLE t_c7 ON COMMIT DROP AS
SELECT c.id FROM public.calls c JOIN public.purchase_payments pp ON pp.purchase_id = c.purchase_id
WHERE pp.payment_id = '5eed0000-0000-4000-8000-0000000c0007' AND c.kind = 'payment';
SELECT public.call_mark((SELECT id FROM t_c7), (SELECT admin FROM t_ids), 'done', null, 'Will pay tonight', null)::text = '' AS marked;
UPDATE public.calls SET closed_at = now() - interval '2 hours' WHERE id = (SELECT id FROM t_c7);
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, created_at)
VALUES ('5eed0000-0000-4000-8000-0000000c0008', '+919999900085', 'MA', 'razorpay', 350000, 'created', 'order_STAGINGFAKE_C8', now() - interval '45 minutes');
SELECT 'Done, then a try still unpaid after 30 minutes: the same Payment call reopens, due 2 working hours after those 30 minutes',
  (SELECT status = 'open' AND due_at = public.add_working_hours(now() - interval '15 minutes', 2) FROM public.calls WHERE id = (SELECT id FROM t_c7))
  AND EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT id FROM t_c7) AND event = 'try_failed');

-- 6d. Go-live (owner, 2026-11-20). Go-live is set to yesterday for this test.
UPDATE public.call_settings SET go_live_at = now() - interval '1 day';
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, created_at, method, reference, recorded_by, proof_file_id, proof_url)
SELECT v.id, v.phone, 'IA', 'offline', 350000, 'paid', 'offline_' || v.id, 'offline_' || v.id, now() - v.ago, now() - v.ago, 'upi', 'UPI-GOLIVE-' || v.n, admin, 'fake-proof-g' || v.n, 'https://drive.example/fake-proof-g' || v.n
FROM t_ids, (VALUES ('5eed0000-0000-4000-8000-0000000c0009'::uuid, '+919999900086', interval '10 days', 1),
                    ('5eed0000-0000-4000-8000-0000000c0010'::uuid, '+919999900087', interval '3 days', 2)) AS v(id, phone, ago, n);
SELECT public.calls_sync() >= 0 AS synced;
SELECT 'paid more than 7 days before go-live: no automatic Assessment call',
  NOT EXISTS (SELECT 1 FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id WHERE pu.phone = '+919999900086');
SELECT 'paid in the 7 days before go-live: Assessment call due 2 working hours after go-live (not late at go-live)',
  (SELECT c.created_at = g.go_live_at AND c.due_at = public.add_working_hours(g.go_live_at, 2) AND s.planned_at = c.due_at
   FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
   JOIN public.purchase_stages s ON s.purchase_id = pu.id AND s.stage = 'assessment', public.call_settings g
   WHERE pu.phone = '+919999900087' AND c.kind = 'assessment');

-- 7. Access: the same people who see the purchase.
SELECT 'as coordinator', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'coordinator@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SELECT set_config('test.coord', (SELECT id::text FROM public.profiles WHERE email = 'coordinator@example.com'), true) IS NOT NULL AS ok;
SET LOCAL ROLE authenticated;
SELECT 'coordinator: sees only calls of their own clients, with their history',
  NOT EXISTS (SELECT 1 FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
              WHERE pu.coordinator_id::text IS DISTINCT FROM current_setting('test.coord'))
  AND (SELECT count(*) FROM public.calls) = (SELECT count(*) FROM public.calls c WHERE EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = c.purchase_id))
  AND NOT EXISTS (SELECT 1 FROM public.call_logs l WHERE NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = l.call_id));
RESET ROLE;
SELECT 'as counsellor', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'counsellor@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'counsellor: sees no calls', (SELECT count(*) = 0 FROM public.calls) AND (SELECT count(*) = 0 FROM public.call_logs);
RESET ROLE;

ROLLBACK;

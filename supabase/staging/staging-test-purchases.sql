-- STAGING ONLY. Behaviour test for step 1 (purchases, payment attempts, purchase journey, coordinator per
-- client, moving a coordinator's clients).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-purchases.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
  IF (SELECT count(*) FROM public.profiles WHERE role = 'coordinator' AND is_active) < 2 THEN
    RAISE EXCEPTION 'This test needs two active coordinators.';
  END IF;
END $$;

CREATE TEMP TABLE t_ids ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin;

-- 1. A failed pay-page try is a payment attempt, not a purchase. A second try joins the same attempt.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000a0001', '+919999900091', 'IA', 'razorpay', 350000, 'failed', 'order_STAGINGFAKE_P1');

SELECT 'a failed try is a payment attempt: Assessment, IA, phone, amount, not paid, with a coordinator',
  (SELECT pu.kind = 'assessment' AND pu.test_code = 'IA' AND pu.phone = '+919999900091' AND pu.amount_paise = 350000
          AND pu.status = 'not_paid' AND pu.source = 'pay_page' AND pu.coordinator_id IS NOT NULL AND pu.closed_at IS NULL
   FROM public.purchases pu JOIN public.purchase_payments pp ON pp.purchase_id = pu.id
   WHERE pp.payment_id = '5eed0000-0000-4000-8000-0000000a0001');
SELECT 'it is listed in payment_attempts as open, last try failed',
  (SELECT is_open AND last_try_status = 'failed' FROM public.payment_attempts WHERE phone = '+919999900091' AND test_code = 'IA');

INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000a0005', '+919999900091', 'IA', 'razorpay', 350000, 'created', 'order_STAGINGFAKE_P5');
SELECT 'a second unpaid try of the same phone and assessment joins the same attempt (last try: not completed)',
  (SELECT count(DISTINCT pp.purchase_id) = 1 FROM public.purchase_payments pp
   WHERE pp.payment_id IN ('5eed0000-0000-4000-8000-0000000a0001', '5eed0000-0000-4000-8000-0000000a0005'))
  AND (SELECT count(*) = 1 AND bool_and(last_try_status = 'not_completed')
       FROM public.payment_attempts WHERE phone = '+919999900091' AND test_code = 'IA');
SELECT 'its journey: five stages, Payment is now, the rest wait',
  (SELECT string_agg(s.stage || ':' || s.status, ',' ORDER BY s.position)
   FROM public.purchase_stages s JOIN public.purchase_payments pp ON pp.purchase_id = s.purchase_id
   WHERE pp.payment_id = '5eed0000-0000-4000-8000-0000000a0001')
  = 'payment:open,assessment:waiting,presentation_booking:waiting,report_presentation:waiting,package_call:waiting';
CREATE TEMP TABLE t_attempt1 ON COMMIT DROP AS
SELECT purchase_id AS id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000a0001';

INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url)
SELECT '5eed0000-0000-4000-8000-0000000a0002', '+919999900091', 'IA', 'offline', 350000, 'paid',
       'offline_5eed0000-0000-4000-8000-0000000a0002', 'offline_5eed0000-0000-4000-8000-0000000a0002', now(), 'upi', 'UPI-TEST-1', admin, 'fake-proof-1', 'https://drive.example/fake-proof-1'
FROM t_ids;

SELECT 'manual payment: the open attempt becomes the purchase (same row, same coordinator), Paid',
  (SELECT pp.purchase_id = (SELECT id FROM t_attempt1) FROM public.purchase_payments pp WHERE pp.payment_id = '5eed0000-0000-4000-8000-0000000a0002')
  AND (SELECT pu.status = 'paid' AND pu.paid_at IS NOT NULL
              AND pu.coordinator_id = (SELECT coordinator_id FROM public.client_coordinators WHERE phone = '+919999900091')
       FROM public.purchases pu WHERE pu.id = (SELECT id FROM t_attempt1))
  AND NOT EXISTS (SELECT 1 FROM public.payment_attempts WHERE phone = '+919999900091' AND test_code = 'IA');
SELECT 'the manual payment shows Accounts check: pending',
  (SELECT accounts_check = 'pending' FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000a0002')
  AND (SELECT accounts_check IS NULL FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000a0001');
SELECT 'Payment stage done at the paid time; Assessment is now',
  (SELECT string_agg(s.stage || ':' || s.status, ',' ORDER BY s.position)
   FROM public.purchase_stages s WHERE s.purchase_id = (SELECT id FROM t_attempt1))
  = 'payment:done,assessment:open,presentation_booking:waiting,report_presentation:waiting,package_call:waiting'
  AND (SELECT s.done_at = p.paid_at FROM public.purchase_stages s, public.payments p
       WHERE s.purchase_id = (SELECT id FROM t_attempt1) AND s.stage = 'payment' AND p.id = '5eed0000-0000-4000-8000-0000000a0002');

-- 2. A manual payment with no open attempt makes a new Paid purchase.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url)
SELECT '5eed0000-0000-4000-8000-0000000a0003', '+919999900091', 'MA', 'offline', 350000, 'paid',
       'offline_5eed0000-0000-4000-8000-0000000a0003', 'offline_5eed0000-0000-4000-8000-0000000a0003', now(), 'bank_transfer', 'UTR-TEST-1', admin, 'fake-proof-2', 'https://drive.example/fake-proof-2'
FROM t_ids;
SELECT 'manual payment with no open attempt: a new Paid purchase (source manual)',
  (SELECT pu.status = 'paid' AND pu.source = 'manual' AND pu.test_code = 'MA'
   FROM public.purchases pu JOIN public.purchase_payments pp ON pp.purchase_id = pu.id
   WHERE pp.payment_id = '5eed0000-0000-4000-8000-0000000a0003');

-- 3. Coordinator: same phone keeps its coordinator; a new phone gets the next one.
SELECT 'returning client: every purchase of the phone has the same coordinator',
  (SELECT count(DISTINCT coordinator_id) = 1 AND count(*) = 2 FROM public.purchases WHERE phone = '+919999900091');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000a0004', '+919999900092', 'IA', 'razorpay', 350000, 'created', 'order_STAGINGFAKE_P4');
SELECT 'new phone: round robin gives the next coordinator, kept on the attempt',
  (SELECT coordinator_id FROM public.purchases WHERE phone = '+919999900092')
  IS DISTINCT FROM (SELECT coordinator_id FROM public.purchases WHERE phone = '+919999900091' LIMIT 1)
  AND (SELECT coordinator_id FROM public.client_coordinators WHERE phone = '+919999900092')
      = (SELECT coordinator_id FROM public.payment_attempts WHERE phone = '+919999900092');

-- 4. A try paid later (Razorpay): the attempt becomes the purchase in place.
SELECT 'before paying: an attempt, not a purchase',
  (SELECT status = 'not_paid' FROM public.purchases WHERE phone = '+919999900092');
UPDATE public.payments SET status = 'paid', provider_payment_id = 'pay_STAGINGFAKE_P4', paid_at = now()
WHERE id = '5eed0000-0000-4000-8000-0000000a0004';
SELECT 'a try paid later: the same row becomes the Paid purchase',
  (SELECT count(*) = 1 AND bool_and(status = 'paid') FROM public.purchases WHERE phone = '+919999900092');

-- 4b. Paid twice: a checkout left open, a manual payment added, then the checkout is paid too.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-0000000a0006', '+919999900093', 'IA', 'razorpay', 350000, 'created', 'order_STAGINGFAKE_P6');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url)
SELECT '5eed0000-0000-4000-8000-0000000a0007', '+919999900093', 'IA', 'offline', 350000, 'paid',
       'offline_5eed0000-0000-4000-8000-0000000a0007', 'offline_5eed0000-0000-4000-8000-0000000a0007', now(), 'upi', 'UPI-TEST-2', admin, 'fake-proof-3', 'https://drive.example/fake-proof-3'
FROM t_ids;
UPDATE public.payments SET status = 'paid', provider_payment_id = 'pay_STAGINGFAKE_P6', paid_at = now() + interval '1 minute'
WHERE id = '5eed0000-0000-4000-8000-0000000a0006';
-- Since 20261123000000 (owner, 2026-11-23): the purchase is open, so the second payment starts no second journey;
-- it is kept on the purchase and marked Refund needed (it was two Paid purchases before).
SELECT 'paid twice: one Paid purchase; the second payment is kept on it, Refund needed',
  (SELECT count(*) = 1 AND bool_and(status = 'paid') FROM public.purchases WHERE phone = '+919999900093')
  AND (SELECT count(DISTINCT purchase_id) = 1 FROM public.purchase_payments
       WHERE payment_id IN ('5eed0000-0000-4000-8000-0000000a0006', '5eed0000-0000-4000-8000-0000000a0007'))
  AND (SELECT refund_status = 'needed' FROM public.payments WHERE id = '5eed0000-0000-4000-8000-0000000a0006')
  AND (SELECT refund_status IS NULL FROM public.payments WHERE id = '5eed0000-0000-4000-8000-0000000a0007');

-- 5. Assessment completed: the Assessment stage gets the completed time.
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
VALUES ('5eed0000-0000-4000-8000-0000000a00c1', '+919999900092', 'Purchase Test', 'Female', 30, 'Single');
UPDATE public.payments SET client_id = '5eed0000-0000-4000-8000-0000000a00c1', claimed_at = now()
WHERE id = '5eed0000-0000-4000-8000-0000000a0004';
CREATE TEMP TABLE t_attempt ON COMMIT DROP AS
SELECT public.create_paid_attempt('5eed0000-0000-4000-8000-0000000a00c1', 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'),
  'pay_STAGINGFAKE_P4', now(), 'en') AS result;
UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = 'pay_STAGINGFAKE_P4')
WHERE id = '5eed0000-0000-4000-8000-0000000a0004' AND attempt_id IS NULL;
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = 'pay_STAGINGFAKE_P4';
SELECT 'assessment started, not completed: Assessment still now',
  (SELECT s.status = 'open' AND s.done_at IS NULL FROM public.purchase_stages s JOIN public.purchases pu ON pu.id = s.purchase_id
   WHERE pu.phone = '+919999900092' AND s.stage = 'assessment');
UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = 'pay_STAGINGFAKE_P4';
SELECT 'assessment completed: Assessment done at the completed time, Presentation booking is now',
  (SELECT s.status = 'done' AND s.done_at = a.completed_at
   FROM public.purchase_stages s JOIN public.purchases pu ON pu.id = s.purchase_id, public.attempts a
   WHERE pu.phone = '+919999900092' AND s.stage = 'assessment' AND a.payment_ref = 'pay_STAGINGFAKE_P4')
  AND (SELECT s.status = 'open' FROM public.purchase_stages s JOIN public.purchases pu ON pu.id = s.purchase_id
       WHERE pu.phone = '+919999900092' AND s.stage = 'presentation_booking');

-- 6. Refund and cancel.
UPDATE public.payments SET refund_status = 'refunded' WHERE id = '5eed0000-0000-4000-8000-0000000a0004';
SELECT 'refunded payment: purchase Refunded',
  (SELECT status = 'refunded' FROM public.purchases WHERE phone = '+919999900092');
UPDATE public.payments SET status = 'cancelled', cancelled_at = now(), cancelled_by = (SELECT admin FROM t_ids), cancel_reason = 'Entered twice'
WHERE id = '5eed0000-0000-4000-8000-0000000a0003';
SELECT 'cancelled manual payment: purchase Cancelled',
  (SELECT pu.status = 'cancelled' FROM public.purchases pu JOIN public.purchase_payments pp ON pp.purchase_id = pu.id
   WHERE pp.payment_id = '5eed0000-0000-4000-8000-0000000a0003');

-- 7. Access: a coordinator reads only their own purchases and attempts.
SELECT 'as coordinator', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'coordinator@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SELECT set_config('test.coord', (SELECT id::text FROM public.profiles WHERE email = 'coordinator@example.com'), true) IS NOT NULL AS ok;
SET LOCAL ROLE authenticated;
SELECT 'coordinator: sees only purchases and attempts where they are the coordinator',
  (SELECT count(*) > 0 FROM public.purchases)
  AND NOT EXISTS (SELECT 1 FROM public.purchases WHERE coordinator_id::text IS DISTINCT FROM current_setting('test.coord'))
  AND NOT EXISTS (SELECT 1 FROM public.payment_attempts WHERE coordinator_id::text IS DISTINCT FROM current_setting('test.coord'));
RESET ROLE;
SELECT 'as counsellor', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'counsellor@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'counsellor: sees no purchases and no payment attempts',
  (SELECT count(*) = 0 FROM public.purchases) AND (SELECT count(*) = 0 FROM public.payment_attempts);
RESET ROLE;

-- 8. Make inactive is blocked while the coordinator has clients; after Move clients it works.
CREATE TEMP TABLE t_move ON COMMIT DROP AS
SELECT c1.id AS c1, c2.id AS c2,
       (SELECT count(*) FROM public.client_coordinators WHERE coordinator_id = c1.id) AS n
FROM public.profiles c1, public.profiles c2
WHERE c1.email = 'coordinator@example.com' AND c2.email = 'coordinator2@example.com';
DO $$
BEGIN
  BEGIN
    UPDATE public.profiles SET is_active = false WHERE email = 'coordinator@example.com';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Move their clients first.' THEN
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Make inactive was not blocked';
END $$;
SELECT 'Make inactive with clients: blocked with "Move their clients first."',
  (SELECT is_active FROM public.profiles WHERE email = 'coordinator@example.com') AND (SELECT n > 0 FROM t_move);
-- (Separate statements: one SELECT does not see what a function inside it changed.)
CREATE TEMP TABLE t_moved ON COMMIT DROP AS
SELECT public.move_coordinator_clients(c1, c2, (SELECT admin FROM t_ids)) AS moved FROM t_move;
SELECT 'Move clients: every client, purchase and attempt of coordinator 1 now has coordinator 2; the move is logged',
  (SELECT moved FROM t_moved) = n
  AND NOT EXISTS (SELECT 1 FROM public.client_coordinators WHERE coordinator_id = c1)
  AND NOT EXISTS (SELECT 1 FROM public.purchases WHERE coordinator_id = c1)
  AND EXISTS (SELECT 1 FROM public.coordinator_client_moves WHERE from_coordinator_id = c1 AND to_coordinator_id = c2 AND clients_moved = n)
FROM t_move;
UPDATE public.profiles SET is_active = false WHERE email = 'coordinator@example.com';
SELECT 'with no clients left, Make inactive works',
  NOT (SELECT is_active FROM public.profiles WHERE email = 'coordinator@example.com');
DO $$
BEGIN
  BEGIN
    PERFORM public.move_coordinator_clients((SELECT c2 FROM t_move), (SELECT c1 FROM t_move), NULL);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'The new coordinator must be an active coordinator.' THEN
      RETURN;
    END IF;
    RAISE;
  END;
  RAISE EXCEPTION 'Move to an inactive coordinator was not refused';
END $$;
SELECT 'moving clients to an inactive coordinator is refused', true;

ROLLBACK;

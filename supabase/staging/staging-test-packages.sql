-- STAGING ONLY. Behaviour test for step 6 (package offer, package payments, Package call choices).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-packages.sql

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
       (SELECT id FROM public.profiles WHERE email = 'counsellor@example.com') AS counsellor;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;

-- A client with a paid, completed, booked assessment purchase (helper for two clients).
CREATE FUNCTION pg_temp.make_purchase(p_n int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_client uuid := ('5eed0000-0000-4000-8000-0000000f00c' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-0000000f000' || p_n)::uuid;
  v_ref text := 'offline_f' || p_n;
  v_purchase uuid;
BEGIN
  INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
  VALUES (v_client, '+91999990004' || p_n, 'Package Test ' || p_n, 'Female', 30, 'Single');
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
  SELECT v_pay, '+91999990004' || p_n, 'IA', 'offline', 350000, 'paid', v_ref, v_ref, now(), 'upi', 'UPI-PKG-' || p_n, admin,
         'fake-proof-k' || p_n, 'https://drive.example/fake-proof-k' || p_n, v_client, now() FROM t;
  PERFORM public.create_paid_attempt(v_client, 'IA', (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
  UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE id = v_pay;
  UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
  UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  SELECT purchase_id INTO v_purchase FROM public.purchase_payments WHERE payment_id = v_pay;
  PERFORM public.presentation_book(v_purchase, f.counsellor_id, f.on_date, f.start_time, (SELECT admin FROM t))
  FROM (SELECT * FROM public.free_presentation_slots(current_date + 1, current_date + 29) ORDER BY on_date, start_time LIMIT 1) f;
  RETURN v_purchase;
END;
$$;

CREATE TEMP TABLE p ON COMMIT DROP AS SELECT pg_temp.make_purchase(1) AS p1, pg_temp.make_purchase(2) AS p2;

-- 1. The offer.
SELECT 'no offer before the report presentation is done',
  NOT EXISTS (SELECT 1 FROM public.package_offer((SELECT p1 FROM p)));
SELECT public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT p1 FROM p) AND status = 'booked'), (SELECT admin FROM t))::text = '' AS done1;
SELECT public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT p2 FROM p) AND status = 'booked'), (SELECT admin FROM t))::text = '' AS done2;
SELECT 'after it is done: 8 sessions, ₹35,000 − ₹3,500 already paid = ₹31,500; listed for the client',
  (SELECT sessions = 8 AND frequency = '1 session every week' AND price_paise = 3500000 AND advance_paise = 350000 AND amount_paise = 3150000
   FROM public.package_offer((SELECT p1 FROM p)))
  AND (SELECT count(*) = 1 AND bool_and(amount_paise = 3150000) FROM public.package_offers_for_client('5eed0000-0000-4000-8000-0000000f00c1'));

-- 2. Package call choices.
CREATE TEMP TABLE c ON COMMIT DROP AS
SELECT (SELECT id FROM public.calls WHERE purchase_id = (SELECT p1 FROM p) AND kind = 'package') AS c1,
       (SELECT id FROM public.calls WHERE purchase_id = (SELECT p2 FROM p) AND kind = 'package') AS c2;
SELECT '"Done" is no longer a choice on a Package call; "agreed" is only for Package calls and needs a follow-up',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''done'', null, null, null)', (SELECT c1 FROM c), (SELECT admin FROM t)),
                     'Choose what happened on the call.')
  AND pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''agreed'', null, null, null)', (SELECT c1 FROM c), (SELECT admin FROM t)),
                         'Pick a follow-up date and time within 2 working days.');
SELECT public.call_mark((SELECT c1 FROM c), (SELECT admin FROM t), 'agreed', null, 'Will pay tonight', now() + interval '1 hour')::text = '' AS marked;
SELECT 'Client agreed – will pay: the call stays open with the follow-up as its due time; journey not done yet',
  (SELECT status = 'open' AND due_at = now() + interval '1 hour' FROM public.calls WHERE id = (SELECT c1 FROM c))
  AND (SELECT done_at IS NULL FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM p) AND stage = 'package_call');

-- 3. Razorpay try (the client app records the order; the amount is checked here).
SELECT 'an order with another amount, or for someone else''s purchase, is refused',
  pg_temp.fails_with(format('SELECT public.package_payment_start(gen_random_uuid(), %L, %L, ''order_PKG_X'', 100)',
                            (SELECT p1 FROM p), '5eed0000-0000-4000-8000-0000000f00c1'), 'The amount does not match.')
  AND pg_temp.fails_with(format('SELECT public.package_payment_start(gen_random_uuid(), %L, %L, ''order_PKG_Y'', 3150000)',
                                (SELECT p1 FROM p), '5eed0000-0000-4000-8000-0000000f00c2'), 'This offer was not found.');
SELECT public.package_payment_start('5eed0000-0000-4000-8000-0000000f0a01', (SELECT p1 FROM p), '5eed0000-0000-4000-8000-0000000f00c1', 'order_PKG_1', 3150000)::text = '' AS started;

-- 3a. It fails: a history line; the open call is not moved.
SELECT public.package_payment_mark_failed('5eed0000-0000-4000-8000-0000000f0a01', 'pay_PKG_FAIL', 'BAD_REQUEST_ERROR', 'Payment failed')::text = '' AS failed;
SELECT 'failed package payment: a history line on the Package call; an open call keeps its due time',
  EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'package_payment_failed')
  AND (SELECT status = 'open' AND due_at = now() + interval '1 hour' FROM public.calls WHERE id = (SELECT c1 FROM c));

-- 3b. Not interested, then a try left not completed for 30 minutes: the call reopens.
SELECT public.call_mark((SELECT c1 FROM c), (SELECT admin FROM t), 'not_interested', 'too_costly', 'Too expensive for now', null)::text = '' AS marked;
INSERT INTO public.package_payments (id, purchase_id, package_id, package_name, sessions, frequency, price_paise, advance_paise, amount_paise, phone, client_id, provider_order_id, created_at)
SELECT '5eed0000-0000-4000-8000-0000000f0a02', (SELECT p1 FROM p), o.package_id, o.name, o.sessions, o.frequency, o.price_paise, o.advance_paise, o.amount_paise,
       '+919999900041', '5eed0000-0000-4000-8000-0000000f00c1', 'order_PKG_2', now() - interval '45 minutes'
FROM public.package_offer((SELECT p1 FROM p)) o;
SELECT public.calls_sync() >= 0 AS synced;
SELECT 'not completed for 30 minutes: history line, and the closed Package call reopens, due 2 working hours after those 30 minutes',
  EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'package_payment_not_completed')
  AND EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'reopened')
  AND (SELECT status = 'open' AND due_at = public.add_working_hours(now() - interval '15 minutes', 2) FROM public.calls WHERE id = (SELECT c1 FROM c));

-- 3c. That order is paid after all.
SELECT 'Razorpay payment confirmed: paid',
  public.package_payment_mark_paid('5eed0000-0000-4000-8000-0000000f0a02', 'pay_PKG_OK', 'upi', now()) = 'paid';
SELECT 'a Package purchase: ₹31,500, paid, linked to the assessment purchase, same client and coordinator',
  (SELECT x.kind = 'package' AND x.status = 'paid' AND x.amount_paise = 3150000 AND x.source = 'pay_page'
          AND x.client_id = pu.client_id AND x.coordinator_id IS NOT DISTINCT FROM pu.coordinator_id AND x.phone = pu.phone
   FROM public.purchases x JOIN public.purchases pu ON pu.id = x.parent_purchase_id WHERE x.parent_purchase_id = (SELECT p1 FROM p));
SELECT 'the Package call closed as Package paid; journey Package call actual = paid time; all five stages done',
  (SELECT status = 'closed' AND outcome = 'package_paid' FROM public.calls WHERE id = (SELECT c1 FROM c))
  AND EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'package_paid')
  AND (SELECT done_at = now() FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM p) AND stage = 'package_call')
  AND (SELECT bool_and(status = 'done') FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM p));
SELECT 'no offer any more; confirming the same payment again changes nothing',
  NOT EXISTS (SELECT 1 FROM public.package_offer((SELECT p1 FROM p)))
  AND public.package_payment_mark_paid('5eed0000-0000-4000-8000-0000000f0a02', 'pay_PKG_OK', 'upi', now()) = 'paid'
  AND (SELECT count(*) = 1 FROM public.purchases WHERE parent_purchase_id = (SELECT p1 FROM p));

-- 3d. Razorpay charges a second time (another order of the same purchase): no second package, flagged for a refund.
INSERT INTO public.package_payments (id, purchase_id, package_id, package_name, sessions, frequency, price_paise, advance_paise, amount_paise, phone, client_id, provider_order_id)
SELECT '5eed0000-0000-4000-8000-0000000f0a03', purchase_id, package_id, package_name, sessions, frequency, price_paise, advance_paise, amount_paise, phone, client_id, 'order_PKG_3'
FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-0000000f0a02';
CREATE TEMP TABLE twice ON COMMIT DROP AS
SELECT public.package_payment_mark_paid('5eed0000-0000-4000-8000-0000000f0a03', 'pay_PKG_TWICE', 'card', now()) AS result;
SELECT 'paid twice: the second payment makes no package and is flagged Refund needed',
  (SELECT result = 'duplicate' FROM twice)
  AND (SELECT refund_status = 'needed' AND package_purchase_id IS NULL FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-0000000f0a03')
  AND (SELECT count(*) = 1 FROM public.purchases WHERE parent_purchase_id = (SELECT p1 FROM p))
  AND EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'package_refund_needed');
SELECT 'a manual package payment for an already paid purchase is refused',
  pg_temp.fails_with(format('SELECT public.package_payment_manual(gen_random_uuid(), %L, %L, ''upi'', ''X'', null, now(), ''f'', ''https://drive.example/f'')',
                            (SELECT p1 FROM p), (SELECT admin FROM t)), 'A package is already paid for this purchase.');

-- 4. Manual package payment (second client).
SELECT 'only this client''s coordinator or a super admin; a counsellor never',
  pg_temp.fails_with(format('SELECT public.package_payment_manual(gen_random_uuid(), %L, %L, ''upi'', ''UTR1'', null, now(), ''f'', ''https://drive.example/f'')',
                            (SELECT p2 FROM p), (SELECT id FROM public.profiles WHERE role = 'coordinator' AND is_active
                               AND id IS DISTINCT FROM (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p2 FROM p)) LIMIT 1)),
                     'Only this client''s coordinator can add their package payment.')
  AND pg_temp.fails_with(format('SELECT public.package_payment_manual(gen_random_uuid(), %L, %L, ''upi'', ''UTR1'', null, now(), ''f'', ''https://drive.example/f'')',
                                (SELECT p2 FROM p), (SELECT counsellor FROM t)),
                         'Only coordinators and super admins can add a package payment.');
SELECT 'reference and proof are required',
  pg_temp.fails_with(format('SELECT public.package_payment_manual(gen_random_uuid(), %L, %L, ''upi'', ''  '', null, now(), ''f'', ''https://drive.example/f'')',
                            (SELECT p2 FROM p), (SELECT admin FROM t)), 'Enter the reference ID (UPI transaction ID, bank UTR or other).')
  AND pg_temp.fails_with(format('SELECT public.package_payment_manual(gen_random_uuid(), %L, %L, ''upi'', ''UTR1'', null, now(), null, null)',
                                (SELECT p2 FROM p), (SELECT admin FROM t)), 'Add the payment proof (screenshot or PDF).');
SELECT 'manual package payment by the client''s coordinator: paid',
  public.package_payment_manual('5eed0000-0000-4000-8000-0000000f0b01', (SELECT p2 FROM p),
                                (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p2 FROM p)),
                                'bank_transfer', ' UTR  778899 ', 'Paid by NEFT', now(), 'fake-proof-pkg', 'https://drive.example/fake-proof-pkg') = 'paid';
SELECT 'saved with the fixed amount ₹31,500, reference, proof, who recorded it and Accounts check: pending',
  (SELECT amount_paise = 3150000 AND provider = 'offline' AND status = 'paid' AND reference = 'UTR 778899' AND method = 'bank_transfer'
          AND proof_url IS NOT NULL AND recorded_by_name IS NOT NULL AND accounts_check = 'pending' AND package_purchase_id IS NOT NULL
   FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-0000000f0b01');
SELECT 'the Package purchase (source manual) exists and the Package call closed as Package paid',
  (SELECT count(*) = 1 AND bool_and(source = 'manual' AND status = 'paid') FROM public.purchases WHERE parent_purchase_id = (SELECT p2 FROM p))
  AND (SELECT status = 'closed' AND outcome = 'package_paid' FROM public.calls WHERE id = (SELECT c2 FROM c));
SELECT 'package payments are never deleted',
  pg_temp.fails_with('DELETE FROM public.package_payments WHERE id = ''5eed0000-0000-4000-8000-0000000f0b01''', 'Package payments are never removed.');

-- 5. Settings: super admins only; the amount follows the price; an old payment keeps its copy.
SELECT 'only super admins change the package',
  pg_temp.fails_with(format('SELECT public.package_save(%L, ''X plan'', 8, ''weekly'', 4000000)', (SELECT counsellor FROM t)),
                     'Only super admins can change the package.');
SELECT public.package_save((SELECT admin FROM t), 'Counselling package', 10, '1 session every week', 4000000)::text = '' AS saved;
SELECT 'after a price change the paid payments keep the price they were sold at',
  (SELECT price_paise = 4000000 AND sessions = 10 FROM public.packages WHERE is_active)
  AND (SELECT price_paise = 3500000 AND sessions = 8 FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-0000000f0b01');

-- 6. Access.
SELECT 'as counsellor', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'counsellor@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'counsellor: reads no package payments and no package settings',
  (SELECT count(*) = 0 FROM public.package_payments) AND (SELECT count(*) = 0 FROM public.packages);
RESET ROLE;

ROLLBACK;

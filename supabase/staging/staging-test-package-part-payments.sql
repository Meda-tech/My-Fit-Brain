-- STAGING ONLY. Behaviour test for package part payments, the handover to CRM and the CRM role
-- (migration 20261124000000_package_part_payments_crm.sql), with the Pending payment call and the start amount in at most
-- 2 payments (migration 20261125000000_package_pending_payment_call.sql).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-package-part-payments.sql

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
       '5eed0000-0000-4000-8000-0000000e0c01'::uuid AS crm_a,
       '5eed0000-0000-4000-8000-0000000e0c02'::uuid AS crm_b;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;

-- A client with a paid, completed assessment purchase whose report presentation is marked done.
CREATE FUNCTION pg_temp.make_purchase(p_n int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_client uuid := ('5eed0000-0000-4000-8000-0000000e00c' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-0000000e000' || p_n)::uuid;
  v_ref text := 'offline_e' || p_n;
  v_purchase uuid;
BEGIN
  INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
  VALUES (v_client, '+91999990005' || p_n, 'Part Pay Test ' || p_n, 'Female', 30, 'Single');
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
  SELECT v_pay, '+91999990005' || p_n, 'IA', 'offline', 350000, 'paid', v_ref, v_ref, now(), 'upi', 'UPI-PART-' || p_n, admin,
         'fake-proof-e' || p_n, 'https://drive.example/fake-proof-e' || p_n, v_client, now() FROM t;
  PERFORM public.create_paid_attempt(v_client, 'IA', (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
  UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE id = v_pay;
  UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
  UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  SELECT purchase_id INTO v_purchase FROM public.purchase_payments WHERE payment_id = v_pay;
  PERFORM public.presentation_book(v_purchase, f.counsellor_id, f.on_date, f.start_time, (SELECT admin FROM t))
  FROM (SELECT * FROM public.free_presentation_slots(current_date + 1, current_date + 29) ORDER BY on_date, start_time LIMIT 1) f;
  PERFORM public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = v_purchase AND status = 'booked'), (SELECT admin FROM t));
  RETURN v_purchase;
END;
$$;

-- Adds a manual package payment with a follow-up in 1 hour (used only when it stays below the start amount); returns
-- the result ('paid' / 'duplicate').
CREATE FUNCTION pg_temp.add(p_id text, p_purchase uuid, p_by uuid, p_rupees int) RETURNS text LANGUAGE sql AS $$
  SELECT public.package_payment_add(('5eed0000-0000-4000-8000-0000000e0f' || p_id)::uuid, p_purchase, p_by, p_rupees * 100, 'upi',
                                    'UTR-' || p_id, null, now(), 'fake-proof-' || p_id, 'https://drive.example/fake-proof-' || p_id,
                                    now() + interval '1 hour');
$$;
CREATE FUNCTION pg_temp.add_sql(p_purchase uuid, p_by uuid, p_rupees numeric, p_follow_up text DEFAULT 'now() + interval ''1 hour''') RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.package_payment_add(gen_random_uuid(), %L, %L, %s, ''upi'', ''UTR-X'', null, now(), ''f'', ''https://drive.example/f'', %s)',
                p_purchase, p_by, (p_rupees * 100)::int, p_follow_up);
$$;

-- Staging's own CRM logins step aside for this test (rolled back), so the round robin below is known.
ALTER TABLE public.profiles DISABLE TRIGGER profiles_keep_crm_clients;
UPDATE public.profiles SET is_active = false WHERE role = 'crm';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_keep_crm_clients;

CREATE TEMP TABLE p ON COMMIT DROP AS
SELECT pg_temp.make_purchase(1) AS p1, pg_temp.make_purchase(2) AS p2, pg_temp.make_purchase(3) AS p3, pg_temp.make_purchase(4) AS p4;
CREATE TEMP TABLE c ON COMMIT DROP AS
SELECT (SELECT id FROM public.calls WHERE purchase_id = (SELECT p1 FROM p) AND kind = 'package') AS c1,
       (SELECT id FROM public.calls WHERE purchase_id = (SELECT p2 FROM p) AND kind = 'package') AS c2,
       (SELECT id FROM public.calls WHERE purchase_id = (SELECT p3 FROM p) AND kind = 'package') AS c3;
CREATE TEMP TABLE co ON COMMIT DROP AS
SELECT (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p1 FROM p)) AS co1,
       (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p3 FROM p)) AS co3;

-- 1. Settings and the balance.
SELECT 'settings: first payment ₹1,000, start ₹10,000, four milestones (10,000 / 15,000 / 25,000 / 31,500)',
  (SELECT first_min_paise = 100000 AND start_paise = 1000000
          AND milestones = '[{"session":1,"paid_paise":1000000},{"session":2,"paid_paise":1500000},{"session":3,"paid_paise":2500000},{"session":4,"paid_paise":3150000}]'::jsonb
   FROM public.packages WHERE is_active);
SELECT 'balance before any payment: package ₹31,500, paid 0, remaining ₹31,500, not started; the client app offer is the full ₹31,500',
  (SELECT total_paise = 3150000 AND paid_paise = 0 AND remaining_paise = 3150000 AND first_min_paise = 100000 AND start_paise = 1000000 AND NOT started
   FROM public.package_balance((SELECT p1 FROM p)))
  AND (SELECT amount_paise = 3150000 FROM public.package_offer((SELECT p1 FROM p)));

-- 2. A package that starts while no CRM is active waits for one (p4, full amount by Razorpay in the client app).
SELECT public.package_payment_start('5eed0000-0000-4000-8000-0000000e0a04', (SELECT p4 FROM p), '5eed0000-0000-4000-8000-0000000e00c4', 'order_PART_4', 3150000)::text = '' AS started;
SELECT 'full ₹31,500 in the client app: paid',
  public.package_payment_mark_paid('5eed0000-0000-4000-8000-0000000e0a04', 'pay_PART_4', 'upi', now()) = 'paid';
SELECT 'paid in full: Package purchase made (₹31,500, with CRM, no CRM person yet), Package call closed as Package started, nothing remaining',
  (SELECT count(*) = 1 AND bool_and(kind = 'package' AND status = 'paid' AND amount_paise = 3150000 AND source = 'pay_page' AND crm_id IS NULL)
   FROM public.purchases WHERE parent_purchase_id = (SELECT p4 FROM p))
  AND (SELECT status = 'closed' AND outcome = 'package_started' FROM public.calls WHERE purchase_id = (SELECT p4 FROM p) AND kind = 'package')
  AND (SELECT remaining_paise = 0 AND started FROM public.package_balance((SELECT p4 FROM p)))
  AND NOT EXISTS (SELECT 1 FROM public.package_offer((SELECT p4 FROM p)));

-- The CRM role: two CRM people. Adding the first one assigns the waiting package.
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('5eed0000-0000-4000-8000-0000000e0d01', 'authenticated', 'authenticated', 'crm-test-a@example.com'),
  ('5eed0000-0000-4000-8000-0000000e0d02', 'authenticated', 'authenticated', 'crm-test-b@example.com');
INSERT INTO public.profiles (id, auth_user_id, email, full_name, role, is_active, created_at)
SELECT crm_a, '5eed0000-0000-4000-8000-0000000e0d01', 'crm-test-a@example.com', 'Test CRM A', 'crm', true, now() - interval '2 minutes' FROM t;
SELECT 'the role CRM is allowed; the waiting package got the first CRM as soon as one was active',
  (SELECT crm_id = (SELECT crm_a FROM t) FROM public.purchases WHERE parent_purchase_id = (SELECT p4 FROM p))
  AND (SELECT crm_id = (SELECT crm_a FROM t) FROM public.client_crms WHERE phone = '+919999900054');
INSERT INTO public.profiles (id, auth_user_id, email, full_name, role, is_active, created_at)
SELECT crm_b, '5eed0000-0000-4000-8000-0000000e0d02', 'crm-test-b@example.com', 'Test CRM B', 'crm', true, now() - interval '1 minute' FROM t;

-- 3. Part payments by the coordinator (p1).
SELECT 'first payment below ₹1,000, more than the remaining balance, and paise are refused',
  pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 999), 'The first payment must be at least ₹1,000.')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 31501), 'The amount is more than the remaining balance (₹31,500).')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 1000.5), 'Enter the amount in whole rupees.');
SELECT 'a counsellor, another coordinator, and a CRM before the package started cannot add a payment',
  pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT counsellor FROM t), 1000), 'Only coordinators, CRM and super admins can add a package payment.')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT id FROM public.profiles WHERE role = 'coordinator' AND is_active
                                            AND id IS DISTINCT FROM (SELECT co1 FROM co) LIMIT 1), 1000),
                         'Only this client''s coordinator can add their package payment.')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT crm_a FROM t), 1000), 'Only this client''s CRM can add their package payment.');
SELECT 'a part payment below ₹10,000 needs the follow-up about the rest, within 3 working days (27 working hours)',
  pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 4000, 'null'), 'Pick when to call the client about the rest: within 3 working days.')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 4000, 'now() - interval ''1 minute'''),
                         'Pick when to call the client about the rest: within 3 working days.')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 4000, 'public.add_working_hours(now(), 27) + interval ''1 minute'''),
                         'Pick when to call the client about the rest: within 3 working days.');
SELECT '₹4,000 by the coordinator: paid', pg_temp.add('01', (SELECT p1 FROM p), (SELECT co1 FROM co), 4000) = 'paid';
CREATE TEMP TABLE pc ON COMMIT DROP AS
SELECT (SELECT id FROM public.calls WHERE purchase_id = (SELECT p1 FROM p) AND kind = 'pending_payment') AS pc1;
SELECT 'below ₹10,000: no Package purchase; the Package call is done ("Part payment received", with a history line); the purchase is still open',
  NOT EXISTS (SELECT 1 FROM public.purchases WHERE parent_purchase_id = (SELECT p1 FROM p))
  AND (SELECT status = 'closed' AND outcome = 'part_paid' FROM public.calls WHERE id = (SELECT c1 FROM c))
  AND (SELECT count(*) = 1 AND bool_and(note = '₹4,000 · paid ₹4,000 of ₹10,000 to start') FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'package_part_paid')
  AND (SELECT done_at IS NULL FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM p) AND stage = 'package_call')
  AND (SELECT public.purchase_is_open(pu) FROM public.purchases pu WHERE pu.id = (SELECT p1 FROM p));
SELECT 'the Pending payment call is open, due at the follow-up booked with the payment',
  (SELECT calls.status = 'open' AND calls.due_at = f.follow_up_at FROM public.calls, public.package_payments f
   WHERE calls.id = (SELECT pc1 FROM pc) AND f.id = '5eed0000-0000-4000-8000-0000000e0f01')
  AND (SELECT count(*) = 1 AND bool_and(note = 'Paid ₹4,000 of ₹10,000 · ₹6,000 pending') FROM public.call_logs WHERE call_id = (SELECT pc1 FROM pc) AND event = 'created');
SELECT 'balance: paid ₹4,000, remaining ₹27,500; the payment keeps the package amount and waits for the package',
  (SELECT paid_paise = 400000 AND remaining_paise = 2750000 AND NOT started FROM public.package_balance((SELECT p1 FROM p)))
  AND (SELECT amount_paise = 400000 AND price_paise = 3500000 AND advance_paise = 350000 AND counted_at IS NOT NULL AND NOT after_handover
              AND package_purchase_id IS NULL AND accounts_check = 'pending'
       FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-0000000e0f01');
SELECT 'once a part is paid the client app has no offer (it can only take the full amount)',
  NOT EXISTS (SELECT 1 FROM public.package_offer((SELECT p1 FROM p)))
  AND pg_temp.fails_with(format('SELECT public.package_payment_start(gen_random_uuid(), %L, %L, ''order_PART_X'', 3150000)',
                                (SELECT p1 FROM p), '5eed0000-0000-4000-8000-0000000e00c1'), 'This offer is not available.');

-- The Pending payment call: follow-ups within 3 working days; Not interested with money received: only an admin.
SELECT 'the Pending payment call takes a follow-up up to 3 working days (other calls 2), not later',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''talked'', null, null, %L)', (SELECT pc1 FROM pc), (SELECT co1 FROM co),
                            public.add_working_hours(now(), 27) + interval '1 minute'), 'Pick a follow-up date and time within 3 working days.');
SELECT public.call_mark((SELECT pc1 FROM pc), (SELECT co1 FROM co), 'talked', null, null, public.add_working_hours(now(), 26))::text = '' AS call_1;
SELECT public.call_mark((SELECT pc1 FROM pc), (SELECT co1 FROM co), 'not_picked', null, null, now() + interval '1 hour')::text = '' AS call_2;
SELECT 'the follow-up moved the due time; a coordinator cannot mark Not interested once a package amount is paid',
  (SELECT status = 'open' AND due_at = (SELECT max(follow_up_at) FILTER (WHERE choice = 'not_picked') FROM public.call_logs WHERE call_id = (SELECT pc1 FROM pc))
   FROM public.calls WHERE id = (SELECT pc1 FROM pc))
  AND pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', ''not_now'', null, null)', (SELECT pc1 FROM pc), (SELECT co1 FROM co)),
                         'A package payment is already received. Only an admin can mark Not interested.');

SELECT 'the start amount in at most 2 payments: the second must make up the rest of ₹10,000',
  pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 500), 'The second payment must be at least ₹6,000 (₹10,000 in total to start sessions).')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 5999), 'The second payment must be at least ₹6,000 (₹10,000 in total to start sessions).');
SELECT 'more than the remaining balance (₹27,500) is refused',
  pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 27501), 'The amount is more than the remaining balance (₹27,500).');
SELECT '₹6,000 more: paid in total ₹10,000', pg_temp.add('03', (SELECT p1 FROM p), (SELECT co1 FROM co), 6000) = 'paid';
SELECT 'at ₹10,000: Package purchase "Started – with CRM" (package amount ₹31,500, same client and coordinator), next CRM in turn',
  (SELECT count(*) = 1 AND bool_and(x.kind = 'package' AND x.status = 'paid' AND x.amount_paise = 3150000 AND x.source = 'manual'
                                    AND x.client_id = pu.client_id AND x.coordinator_id = pu.coordinator_id AND x.crm_id = (SELECT crm_b FROM t))
   FROM public.purchases x JOIN public.purchases pu ON pu.id = x.parent_purchase_id WHERE x.parent_purchase_id = (SELECT p1 FROM p))
  AND (SELECT crm_id = (SELECT crm_b FROM t) FROM public.client_crms WHERE phone = '+919999900051');
SELECT 'the Pending payment call closed as Package started (the Package call stays "Part payment received"); journey Package call done; both payments belong to the package; purchase finished',
  (SELECT status = 'closed' AND outcome = 'package_started' FROM public.calls WHERE id = (SELECT pc1 FROM pc))
  AND (SELECT outcome = 'part_paid' FROM public.calls WHERE id = (SELECT c1 FROM c))
  AND (SELECT count(*) = 1 AND bool_and(note = 'Paid ₹10,000 of ₹31,500 · with CRM') FROM public.call_logs WHERE call_id = (SELECT pc1 FROM pc) AND event = 'package_started')
  AND NOT EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'package_started')
  AND (SELECT done_at IS NOT NULL FROM public.purchase_stages WHERE purchase_id = (SELECT p1 FROM p) AND stage = 'package_call')
  AND (SELECT count(*) = 2 AND bool_and(package_purchase_id = (SELECT id FROM public.purchases WHERE parent_purchase_id = (SELECT p1 FROM p)) AND NOT after_handover)
       FROM public.package_payments WHERE purchase_id = (SELECT p1 FROM p))
  AND NOT (SELECT public.purchase_is_open(pu) FROM public.purchases pu WHERE pu.id = (SELECT p1 FROM p));

-- After the handover: the coordinator is done; the client's CRM (or a super admin) collects the rest.
SELECT 'after the handover the coordinator cannot add payments; another CRM cannot either',
  pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT co1 FROM co), 1000), 'This package has started and is with CRM now.')
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT crm_a FROM t), 1000), 'Only this client''s CRM can add their package payment.');
SELECT 'the client''s CRM adds ₹5,000', pg_temp.add('04', (SELECT p1 FROM p), (SELECT crm_b FROM t), 5000) = 'paid';
SELECT 'it is marked as paid after the handover and belongs to the package; the coordinator''s call history gets no new line',
  (SELECT after_handover AND package_purchase_id IS NOT NULL AND counted_at IS NOT NULL FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-0000000e0f04')
  AND (SELECT count(*) = 1 FROM public.call_logs WHERE call_id = (SELECT c1 FROM c) AND event = 'package_part_paid');
SELECT 'overpayment refused: remaining is ₹16,500',
  pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT admin FROM t), 16501), 'The amount is more than the remaining balance (₹16,500).');
SELECT 'a super admin adds the last ₹16,500', pg_temp.add('05', (SELECT p1 FROM p), (SELECT admin FROM t), 16500) = 'paid';
SELECT 'paid in full: nothing more can be added',
  (SELECT paid_paise = 3150000 AND remaining_paise = 0 FROM public.package_balance((SELECT p1 FROM p)))
  AND pg_temp.fails_with(pg_temp.add_sql((SELECT p1 FROM p), (SELECT admin FROM t), 100), 'This package is already paid in full.')
  AND (SELECT count(*) = 1 FROM public.purchases WHERE parent_purchase_id = (SELECT p1 FROM p));

-- 4. Milestones.
SELECT 'next milestone: ₹4,000 → ₹10,000 before session 1 · ₹10,000 → ₹15,000 before session 2 · ₹26,000 → ₹31,500 before session 4 · paid in full → none',
  (SELECT session = 1 AND paid_paise = 1000000 FROM public.package_next_milestone(400000, 3150000))
  AND (SELECT session = 2 AND paid_paise = 1500000 FROM public.package_next_milestone(1000000, 3150000))
  AND (SELECT session = 4 AND paid_paise = 3150000 FROM public.package_next_milestone(2600000, 3150000))
  AND NOT EXISTS (SELECT 1 FROM public.package_next_milestone(3150000, 3150000));

-- 5. A Razorpay payment that still arrives after a part payment (p3): kept apart, never counted.
SELECT public.package_payment_start('5eed0000-0000-4000-8000-0000000e0a03', (SELECT p3 FROM p), '5eed0000-0000-4000-8000-0000000e00c3', 'order_PART_3', 3150000)::text = '' AS order_made;
SELECT '₹2,000 by the coordinator while that order is open', pg_temp.add('31', (SELECT p3 FROM p), (SELECT co3 FROM co), 2000) = 'paid';
CREATE TEMP TABLE late ON COMMIT DROP AS
SELECT public.package_payment_mark_paid('5eed0000-0000-4000-8000-0000000e0a03', 'pay_PART_3', 'card', now()) AS first_time;
ALTER TABLE late ADD COLUMN again text;
UPDATE late SET again = public.package_payment_mark_paid('5eed0000-0000-4000-8000-0000000e0a03', 'pay_PART_3', 'card', now());
SELECT 'the full ₹31,500 then arrives from Razorpay: more than the remaining ₹29,500 → Refund needed, not counted, no package',
  (SELECT first_time = 'duplicate' AND again = 'duplicate' FROM late)
  AND (SELECT refund_status = 'needed' AND counted_at IS NULL AND package_purchase_id IS NULL FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-0000000e0a03')
  AND (SELECT paid_paise = 200000 AND NOT started FROM public.package_balance((SELECT p3 FROM p)))
  AND (SELECT count(*) = 1 FROM public.call_logs WHERE call_id = (SELECT c3 FROM c) AND event = 'package_refund_needed');

-- 6. Package amounts in Settings.
SELECT 'only super admins change the amounts; the start amount and the milestones are checked',
  pg_temp.fails_with(format('SELECT public.package_amounts_save(%L, 100000, 1000000, ''[]''::jsonb)', (SELECT co1 FROM co)), 'Only super admins can change the package.')
  AND pg_temp.fails_with(format('SELECT public.package_amounts_save(%L, 200000, 100000, ''[]''::jsonb)', (SELECT admin FROM t)),
                         'The start amount must be between the first payment minimum and the package amount.')
  AND pg_temp.fails_with(format('SELECT public.package_amounts_save(%L, 100000, 1000000, %L::jsonb)', (SELECT admin FROM t),
                                '[{"session":1,"paid_paise":1500000},{"session":2,"paid_paise":1000000}]'),
                         'Milestone amounts must go up and never be more than the package amount.')
  AND pg_temp.fails_with(format('SELECT public.package_amounts_save(%L, 100000, 1000000, %L::jsonb)', (SELECT admin FROM t),
                                '[{"session":2,"paid_paise":1000000},{"session":2,"paid_paise":1500000}]'),
                         'Milestone sessions must go up, from 1 to the number of sessions.');
SELECT public.package_amounts_save((SELECT admin FROM t), 50000, 200000, '[{"session":1,"paid_paise":200000},{"session":3,"paid_paise":3150000}]'::jsonb)::text = '' AS saved;
-- (Other part-paid packages on staging start at the same moment, in no fixed order: p3 gets one of the two CRM people.)
SELECT 'saved; a package already paid up to the new, lower start amount (p3, ₹2,000) starts now and gets a CRM',
  (SELECT first_min_paise = 50000 AND start_paise = 200000 AND jsonb_array_length(milestones) = 2 FROM public.packages WHERE is_active)
  AND (SELECT count(*) = 1 AND bool_and(crm_id IN ((SELECT crm_a FROM t), (SELECT crm_b FROM t))) FROM public.purchases WHERE parent_purchase_id = (SELECT p3 FROM p))
  AND (SELECT status = 'closed' AND outcome = 'part_paid' FROM public.calls WHERE id = (SELECT c3 FROM c))
  AND (SELECT status = 'closed' AND outcome = 'package_started' FROM public.calls WHERE purchase_id = (SELECT p3 FROM p) AND kind = 'pending_payment');

-- 7. Who sees what (database rules).
GRANT SELECT ON t, p, c, co, pc TO authenticated;
SELECT 'as CRM B', set_config('request.jwt.claims', json_build_object('sub', '5eed0000-0000-4000-8000-0000000e0d02', 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'CRM: the dashboard lists only their own clients'' packages: name, phone, started, paid, remaining, fully paid',
  (SELECT count(*) = 1 AND bool_and(client_name = 'Part Pay Test 1' AND phone = '+919999900051' AND total_paise = 3150000 AND paid_paise = 3150000
                                    AND remaining_paise = 0 AND next_paid_paise IS NULL AND started_at IS NOT NULL)
   FROM public.crm_packages() WHERE parent_purchase_id = (SELECT p1 FROM p))
  AND (SELECT bool_and(crm_id = (SELECT crm_b FROM t) AND crm_name = 'Test CRM B') FROM public.crm_packages())
  AND NOT EXISTS (SELECT 1 FROM public.crm_packages() WHERE parent_purchase_id = (SELECT p4 FROM p));
SELECT 'CRM: reads the four package payments of that package (with proof links), and only payments of their own clients'' packages',
  (SELECT count(*) = 4 AND bool_and(proof_url IS NOT NULL) FROM public.package_payments WHERE purchase_id = (SELECT p1 FROM p))
  AND NOT EXISTS (SELECT 1 FROM public.package_payments WHERE purchase_id = (SELECT p4 FROM p))
  AND (SELECT bool_and(package_purchase_id IN (SELECT id FROM public.crm_packages())) FROM public.package_payments);
SELECT 'CRM: no clients, assessments, answers, results, client details, conclusions, safety alerts, questionnaire versions, purchases, assessment payments, calls or package settings',
  (SELECT count(*) = 0 FROM public.clients) AND (SELECT count(*) = 0 FROM public.attempts) AND (SELECT count(*) = 0 FROM public.attempt_answers)
  AND (SELECT count(*) = 0 FROM public.attempt_results) AND (SELECT count(*) = 0 FROM public.attempt_details)
  AND (SELECT count(*) = 0 FROM public.attempt_conclusions) AND (SELECT count(*) = 0 FROM public.attempt_alerts)
  AND (SELECT count(*) = 0 FROM public.questionnaire_versions) AND (SELECT count(*) = 0 FROM public.purchases)
  AND (SELECT count(*) = 0 FROM public.payments) AND (SELECT count(*) = 0 FROM public.calls) AND (SELECT count(*) = 0 FROM public.packages)
  AND (SELECT count(*) = 0 FROM public.presentation_bookings);
RESET ROLE;

SELECT 'as the coordinator of client 1', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE id = (SELECT co1 FROM co)), 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'coordinator: still sees the assessment purchase and its closed Package call; no Package purchase row; nothing from the CRM dashboard',
  (SELECT count(*) = 1 FROM public.purchases WHERE id = (SELECT p1 FROM p))
  AND (SELECT count(*) = 1 FROM public.calls WHERE id = (SELECT pc1 FROM pc) AND outcome = 'package_started')
  AND (SELECT count(*) = 0 FROM public.purchases WHERE kind = 'package')
  AND (SELECT count(*) = 0 FROM public.crm_packages());
SELECT 'coordinator: sees only the two payments collected before the handover (₹10,000), not the two made after it',
  (SELECT count(*) = 2 AND sum(amount_paise) = 1000000 AND bool_and(NOT after_handover) FROM public.package_payments WHERE purchase_id = (SELECT p1 FROM p));
RESET ROLE;

SELECT 'as super admin', set_config('request.jwt.claims',
  json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = 'superadmin@example.com'), 'role', 'authenticated')::text, true) IS NOT NULL;
SET LOCAL ROLE authenticated;
SELECT 'super admin: every package on the CRM dashboard, every package payment',
  (SELECT count(*) FILTER (WHERE parent_purchase_id IN ((SELECT p1 FROM p), (SELECT p3 FROM p), (SELECT p4 FROM p))) = 3 FROM public.crm_packages())
  AND (SELECT count(*) = 4 FROM public.package_payments WHERE purchase_id = (SELECT p1 FROM p))
  AND (SELECT next_session = 3 AND next_paid_paise = 3150000 AND remaining_paise = 2950000 FROM public.crm_packages() WHERE parent_purchase_id = (SELECT p3 FROM p));
RESET ROLE;
SELECT 'back to the server role', set_config('request.jwt.claims', '', true) IS NOT NULL;

-- 8. One CRM per client; Move clients before Make inactive.
SELECT 'a returning client keeps their CRM', public.client_crm('+919999900051') = (SELECT crm_b FROM t);
SELECT 'a CRM with clients cannot be made inactive',
  pg_temp.fails_with(format('UPDATE public.profiles SET is_active = false WHERE id = %L', (SELECT crm_b FROM t)), 'Move their clients first.');
SELECT 'only super admins move clients, to an active CRM',
  pg_temp.fails_with(format('SELECT public.move_crm_clients(%L, %L, %L)', (SELECT crm_b FROM t), (SELECT crm_a FROM t), (SELECT co1 FROM co)), 'Only super admins can move clients.')
  AND pg_temp.fails_with(format('SELECT public.move_crm_clients(%L, %L, %L)', (SELECT crm_b FROM t), (SELECT counsellor FROM t), (SELECT admin FROM t)), 'The new CRM must be an active CRM.');
SELECT 'Move clients: every client of CRM B goes to CRM A', public.move_crm_clients((SELECT crm_b FROM t), (SELECT crm_a FROM t), (SELECT admin FROM t)) >= 1;
SELECT 'the package and the client now belong to CRM A; CRM B has none left; the move is logged and cannot be changed',
  (SELECT crm_id = (SELECT crm_a FROM t) FROM public.purchases WHERE parent_purchase_id = (SELECT p1 FROM p))
  AND (SELECT crm_id = (SELECT crm_a FROM t) FROM public.client_crms WHERE phone = '+919999900051')
  AND NOT EXISTS (SELECT 1 FROM public.client_crms WHERE crm_id = (SELECT crm_b FROM t))
  AND NOT EXISTS (SELECT 1 FROM public.purchases WHERE crm_id = (SELECT crm_b FROM t))
  AND (SELECT count(*) = 1 AND bool_and(clients_moved = cardinality(phones) AND '+919999900051' = ANY (phones) AND moved_by_name IS NOT NULL)
       FROM public.crm_client_moves WHERE from_crm_id = (SELECT crm_b FROM t))
  AND pg_temp.fails_with(format('DELETE FROM public.crm_client_moves WHERE from_crm_id = %L', (SELECT crm_b FROM t)), 'Moves are never changed or removed.');
UPDATE public.profiles SET is_active = false WHERE id = (SELECT crm_b FROM t);
SELECT 'CRM B, now without clients, was made inactive', (SELECT NOT is_active FROM public.profiles WHERE id = (SELECT crm_b FROM t));

-- 9. The assessment payments are untouched.
SELECT 'the ₹3,500 assessment payments of these clients are as they were',
  (SELECT count(*) = 4 AND bool_and(status = 'paid' AND amount_paise = 350000) FROM public.payments WHERE provider_order_id LIKE 'offline_e_');

ROLLBACK;

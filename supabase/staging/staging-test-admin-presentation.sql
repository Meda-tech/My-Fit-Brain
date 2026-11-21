-- STAGING ONLY. Behaviour test for 20261121800000_admin_presentation_done.sql:
--   an OLD purchase → admin marks report presentation done → offer visible in the client app → Package call →
--   package paid manually; then the one-time go-live assignment of old clients.
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-admin-presentation.sql

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
       (SELECT id FROM public.profiles WHERE email = 'counsellor2@example.com') AS c2,
       (SELECT go_live_at FROM public.call_settings) AS go,
       (now() AT TIME ZONE 'Asia/Kolkata')::date AS today;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;
CREATE FUNCTION pg_temp.login(p_email text) RETURNS boolean LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', (SELECT auth_user_id FROM public.profiles WHERE email = p_email), 'role', 'authenticated')::text, true) IS NOT NULL;
$$;

-- OLD: paid 10 days before go-live, assessment completed. OLD2: paid 12 days before go-live, assessment not done.
-- NEW: paid now, assessment completed. NOPAY: a registered client who never paid.
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status) VALUES
  ('5eed0000-0000-4000-8000-0000001000c1', '+919999900101', 'Old Offer Client', 'Female', 30, 'Single'),
  ('5eed0000-0000-4000-8000-0000001000c2', '+919999900102', 'Old Unfinished Client', 'Male', 32, 'Single'),
  ('5eed0000-0000-4000-8000-0000001000c3', '+919999900103', 'New Flow Client', 'Female', 28, 'Single'),
  ('5eed0000-0000-4000-8000-0000001000c4', '+919999900104', 'Never Paid Client', 'Male', 41, 'Single');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, created_at,
                             method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
SELECT v.id, v.phone, 'IA', 'offline', 350000, 'paid', 'offline_' || v.id, 'offline_' || v.id, v.paid, v.paid, 'upi', 'UPI-AP-' || v.n, admin,
       'fake-proof-ap' || v.n, 'https://drive.example/fake-proof-ap' || v.n, v.client, v.paid
FROM t, LATERAL (VALUES
  ('5eed0000-0000-4000-8000-000000100001'::uuid, '+919999900101', 1, '5eed0000-0000-4000-8000-0000001000c1'::uuid, t.go - interval '10 days'),
  ('5eed0000-0000-4000-8000-000000100002'::uuid, '+919999900102', 2, '5eed0000-0000-4000-8000-0000001000c2'::uuid, t.go - interval '12 days'),
  ('5eed0000-0000-4000-8000-000000100003'::uuid, '+919999900103', 3, '5eed0000-0000-4000-8000-0000001000c3'::uuid, now())
) AS v(id, phone, n, client, paid);
SELECT public.create_paid_attempt(v.client, 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), 'offline_' || v.pay, now(), 'en') IS NOT NULL AS attempt
FROM (VALUES ('5eed0000-0000-4000-8000-0000001000c1'::uuid, '5eed0000-0000-4000-8000-000000100001'),
             ('5eed0000-0000-4000-8000-0000001000c3'::uuid, '5eed0000-0000-4000-8000-000000100003')) AS v(client, pay);
UPDATE public.payments p SET attempt_id = a.id FROM public.attempts a
WHERE a.payment_ref = 'offline_' || p.id AND p.id IN ('5eed0000-0000-4000-8000-000000100001', '5eed0000-0000-4000-8000-000000100003');
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now()
WHERE client_id IN ('5eed0000-0000-4000-8000-0000001000c1', '5eed0000-0000-4000-8000-0000001000c3');
UPDATE public.attempts SET status = 'completed', completed_at = now()
WHERE client_id IN ('5eed0000-0000-4000-8000-0000001000c1', '5eed0000-0000-4000-8000-0000001000c3');
CREATE TEMP TABLE t_p ON COMMIT DROP AS
SELECT (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000100001') AS p_old,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000100002') AS p_old2,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000100003') AS p_new;
SELECT public.calls_sync() >= 0 AS synced;

-- 1. The old purchase before the admin marks anything.
SELECT '1. old purchase: no Payment, Assessment or Booking call, nothing open or late',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id IN ((SELECT p_old FROM t_p), (SELECT p_old2 FROM t_p)));
SELECT '1. old purchase: NO package offer in the client app before Report presentation done is marked',
  (SELECT count(*) = 0 FROM public.package_offers_for_client('5eed0000-0000-4000-8000-0000001000c1'));
SELECT '1. the counsellor does not see the old client yet',
  NOT EXISTS (SELECT 1 FROM public.client_counsellors WHERE client_id = '5eed0000-0000-4000-8000-0000001000c1');

-- 2. Who may mark, and what.
SELECT '2. only super admins; today or earlier; assessment completed; old purchases only',
  pg_temp.fails_with(format('SELECT public.presentation_mark_done_admin(%L, %L, %L, %L)', (SELECT p_old FROM t_p), (SELECT c2 FROM t), (SELECT today FROM t),
                            (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p_old FROM t_p))),
                     'Only super admins can mark this presentation done.')
  AND pg_temp.fails_with(format('SELECT public.presentation_mark_done_admin(%L, %L, %L, %L)', (SELECT p_old FROM t_p), (SELECT c2 FROM t), (SELECT today + 1 FROM t), (SELECT admin FROM t)),
                         'Choose today or an earlier date.')
  AND pg_temp.fails_with(format('SELECT public.presentation_mark_done_admin(%L, %L, %L, %L)', (SELECT p_old2 FROM t_p), (SELECT c2 FROM t), (SELECT today FROM t), (SELECT admin FROM t)),
                         'The assessment is not completed yet.')
  AND pg_temp.fails_with(format('SELECT public.presentation_mark_done_admin(%L, %L, %L, %L)', (SELECT p_new FROM t_p), (SELECT c2 FROM t), (SELECT today FROM t), (SELECT admin FROM t)),
                         'This purchase runs the normal flow. Book the presentation instead.');

-- 3. Admin marks report presentation done: counsellor c2, it happened 5 days ago. No slot.
SELECT public.presentation_mark_done_admin(p_old, c2, today - 5, admin) IS NOT NULL AS "3. marked by admin" FROM t, t_p;
SELECT '3. stored as a presentation marked done by the admin, on that date, without a slot',
  (SELECT marked_by_admin AND status = 'booked' AND start_time IS NULL AND end_time IS NULL AND on_date = t.today - 5
          AND counsellor_id = t.c2 AND done_at = now() AND done_by_name = 'Test Super Admin'
   FROM public.presentation_bookings, t WHERE purchase_id = (SELECT p_old FROM t_p))
  AND NOT EXISTS (SELECT 1 FROM t, public.counsellor_slots(t.c2, t.today - 5, t.today - 5) s WHERE s.state = 'booked');
SELECT '3. journey: Report presentation done now; the purchase is at the Package call',
  (SELECT done_at = now() AND status = 'done' FROM public.purchase_stages WHERE purchase_id = (SELECT p_old FROM t_p) AND stage = 'report_presentation')
  AND (SELECT status = 'open' AND planned_at = public.add_working_hours(now(), 2) FROM public.purchase_stages
       WHERE purchase_id = (SELECT p_old FROM t_p) AND stage = 'package_call');
SELECT '3. it cannot be marked twice',
  pg_temp.fails_with(format('SELECT public.presentation_mark_done_admin(%L, %L, %L, %L)', (SELECT p_old FROM t_p), (SELECT c2 FROM t), (SELECT today FROM t), (SELECT admin FROM t)),
                     'This purchase already has a presentation.');

-- 4. The offer in the client app (Home reads package_offers_for_client()).
SELECT '4. offer visible in the client app: ₹35,000 − ₹3,500 advance = ₹31,500',
  (SELECT count(*) = 1 AND bool_and(price_paise = 3500000 AND advance_paise = 350000 AND amount_paise = 3150000 AND purchase_id = (SELECT p_old FROM t_p))
   FROM public.package_offers_for_client('5eed0000-0000-4000-8000-0000001000c1'));

-- 5. The Package call, and still no other call.
SELECT public.calls_sync() >= 0 AS synced_again;
SELECT '5. Package call created for the client''s coordinator, due 2 working hours later',
  (SELECT c.status = 'open' AND c.due_at = public.add_working_hours(now(), 2) AND pu.coordinator_id IS NOT NULL
   FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
   WHERE c.purchase_id = (SELECT p_old FROM t_p) AND c.kind = 'package');
SELECT '5. still no Payment, Assessment or Booking call on the old purchase',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p_old FROM t_p) AND kind <> 'package');

-- 6. The client is assigned to that counsellor.
SELECT pg_temp.login('counsellor2@example.com') AS as_c2;
SET LOCAL ROLE authenticated;
SELECT '6. the counsellor now sees this client and their assessment (not the other old client)',
  EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000001000c1')
  AND EXISTS (SELECT 1 FROM public.attempts WHERE client_id = '5eed0000-0000-4000-8000-0000001000c1')
  AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000001000c2');
RESET ROLE;

-- 7. Package paid manually (the same function the "Add package payment" form uses), by the client's coordinator.
SELECT '7. manual package payment: paid',
  public.package_payment_manual('5eed0000-0000-4000-8000-000000100b01', (SELECT p_old FROM t_p),
                                (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p_old FROM t_p)),
                                'upi', 'UPI-OLD-PKG-1', 'Paid by UPI', now(), 'fake-proof-oldpkg', 'https://drive.example/fake-proof-oldpkg') = 'paid';
SELECT '7. saved with the fixed amount ₹31,500, proof and who recorded it; Accounts check: pending',
  (SELECT amount_paise = 3150000 AND status = 'paid' AND proof_url IS NOT NULL AND recorded_by_name IS NOT NULL AND accounts_check = 'pending'
   FROM public.package_payments WHERE id = '5eed0000-0000-4000-8000-000000100b01');
SELECT '7. a Package purchase of ₹31,500 under the old assessment purchase; the Package call closed as package paid',
  (SELECT count(*) = 1 AND bool_and(status = 'paid' AND amount_paise = 3150000)
   FROM public.purchases WHERE parent_purchase_id = (SELECT p_old FROM t_p) AND kind = 'package')
  AND (SELECT status = 'closed' AND outcome = 'package_paid' FROM public.calls WHERE purchase_id = (SELECT p_old FROM t_p) AND kind = 'package');
SELECT '7. the offer is gone from the client app once paid',
  (SELECT count(*) = 0 FROM public.package_offers_for_client('5eed0000-0000-4000-8000-0000001000c1'));

-- 8. Go-live step. As staging stands (2 coordinators, 2 counsellors) it must stop and change nothing.
SELECT '8. go-live step stops unless there is exactly one active coordinator and one active counsellor',
  pg_temp.fails_with('SELECT public.go_live_assign_old_clients()',
    format('Stopped, nothing was changed: this step needs exactly one active coordinator and one active counsellor. Found %s active coordinator(s) and %s active counsellor(s).',
           (SELECT count(*) FROM public.profiles WHERE role = 'coordinator' AND is_active),
           (SELECT count(*) FROM public.profiles WHERE role = 'counsellor' AND is_active)))
  AND (SELECT count(*) > 1 FROM public.profiles WHERE role = 'coordinator' AND is_active);

-- Like production at go-live: one coordinator and one counsellor. (Only for this test, rolled back: the two
-- "Move their clients first" guards are switched off so the others can be made inactive without moving anyone.)
ALTER TABLE public.profiles DISABLE TRIGGER profiles_keep_clients;
ALTER TABLE public.profiles DISABLE TRIGGER profiles_keep_counsellor_clients;
UPDATE public.profiles SET is_active = false WHERE role = 'coordinator' AND email <> 'coordinator@example.com';
UPDATE public.profiles SET is_active = false WHERE role = 'counsellor' AND email <> 'counsellor2@example.com';
ALTER TABLE public.profiles ENABLE TRIGGER profiles_keep_clients;
ALTER TABLE public.profiles ENABLE TRIGGER profiles_keep_counsellor_clients;

CREATE TEMP TABLE t_go ON COMMIT DROP AS SELECT public.go_live_assign_old_clients() AS result;
SELECT '9. go-live step names who got the clients',
  (SELECT result ->> 'coordinator' = 'Test Coordinator' AND result ->> 'counsellor' = 'test counsellor 2' FROM t_go);
SELECT '9. every client (phone) and every purchase has the only coordinator',
  NOT EXISTS (SELECT 1 FROM public.purchases WHERE coordinator_id IS DISTINCT FROM (SELECT id FROM public.profiles WHERE email = 'coordinator@example.com'))
  AND NOT EXISTS (SELECT 1 FROM public.client_coordinators WHERE coordinator_id IS DISTINCT FROM (SELECT id FROM public.profiles WHERE email = 'coordinator@example.com'))
  AND EXISTS (SELECT 1 FROM public.client_coordinators WHERE phone = '+919999900104');
SELECT '9. every client with a paid assessment is assigned to the only counsellor; a client who never paid is not',
  NOT EXISTS (SELECT 1 FROM public.purchases pu
              WHERE pu.kind = 'assessment' AND pu.status = 'paid' AND pu.client_id IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM public.client_counsellors cc, t
                                WHERE cc.client_id = pu.client_id AND cc.counsellor_id = t.c2 AND cc.ended_at IS NULL))
  AND EXISTS (SELECT 1 FROM public.client_counsellors WHERE client_id = '5eed0000-0000-4000-8000-0000001000c2' AND at_go_live)
  AND NOT EXISTS (SELECT 1 FROM public.client_counsellors WHERE client_id = '5eed0000-0000-4000-8000-0000001000c4');
SELECT pg_temp.login('counsellor2@example.com') AS as_c2_again;
SET LOCAL ROLE authenticated;
SELECT '9. the counsellor now sees the old client''s record (old reports stay visible); not the never-paid client',
  EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000001000c2')
  AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000001000c4');
RESET ROLE;
SELECT pg_temp.login('superadmin@example.com') AS as_admin;
SET LOCAL ROLE authenticated;
SELECT '9. super admins still see every client',
  (SELECT count(*) = 4 FROM public.clients WHERE id IN ('5eed0000-0000-4000-8000-0000001000c1', '5eed0000-0000-4000-8000-0000001000c2',
                                                       '5eed0000-0000-4000-8000-0000001000c3', '5eed0000-0000-4000-8000-0000001000c4'));
RESET ROLE;
SELECT '9. running the go-live step again adds nothing',
  (SELECT (r ->> 'phones')::int = 0 AND (r ->> 'purchases')::int = 0 AND (r ->> 'clients_to_counsellor')::int = 0
   FROM (SELECT public.go_live_assign_old_clients() AS r) x);
SELECT '9. after the go-live step the old purchases still have no automatic call',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p_old2 FROM t_p));

ROLLBACK;

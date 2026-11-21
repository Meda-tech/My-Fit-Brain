-- STAGING ONLY. Behaviour test for "Before the system" (20261121700000_before_system.sql).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-before-system.sql

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
       public.booking_last_day() AS day;

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

-- Three paid clients: OLD (paid 10 days before go-live), EDGE (3 days before go-live), NEW (now).
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status) VALUES
  ('5eed0000-0000-4000-8000-0000000f00c1', '+919999900091', 'Old Client', 'Female', 30, 'Single'),
  ('5eed0000-0000-4000-8000-0000000f00c2', '+919999900092', 'Edge Client', 'Male', 32, 'Single'),
  ('5eed0000-0000-4000-8000-0000000f00c3', '+919999900093', 'New Client', 'Female', 28, 'Single');
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, created_at,
                             method, reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
SELECT v.id, v.phone, 'IA', 'offline', 350000, 'paid', 'offline_' || v.id, 'offline_' || v.id, v.paid, v.paid, 'upi', 'UPI-BS-' || v.n, admin,
       'fake-proof-bs' || v.n, 'https://drive.example/fake-proof-bs' || v.n, v.client, v.paid
FROM t, LATERAL (VALUES
  ('5eed0000-0000-4000-8000-0000000f0001'::uuid, '+919999900091', 1, '5eed0000-0000-4000-8000-0000000f00c1'::uuid, t.go - interval '10 days'),
  ('5eed0000-0000-4000-8000-0000000f0002'::uuid, '+919999900092', 2, '5eed0000-0000-4000-8000-0000000f00c2'::uuid, t.go - interval '3 days'),
  ('5eed0000-0000-4000-8000-0000000f0003'::uuid, '+919999900093', 3, '5eed0000-0000-4000-8000-0000000f00c3'::uuid, now())
) AS v(id, phone, n, client, paid);
-- An unpaid try from 20 days before go-live (Razorpay checkout not completed).
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, created_at)
SELECT '5eed0000-0000-4000-8000-0000000f0004', '+919999900094', 'IA', 'razorpay', 350000, 'created', 'order_bs_test_4', go - interval '20 days' FROM t;

CREATE TEMP TABLE t_p ON COMMIT DROP AS
SELECT (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000f0001') AS p_old,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000f0002') AS p_edge,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000f0003') AS p_new,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-0000000f0004') AS p_try;
SELECT public.calls_sync() >= 0 AS synced;

SELECT 'before_system: old paid and old unpaid try yes; 3 days before go-live and new no',
  (SELECT public.before_system(pu) FROM public.purchases pu WHERE id = (SELECT p_old FROM t_p))
  AND (SELECT public.before_system(pu) FROM public.purchases pu WHERE id = (SELECT p_try FROM t_p))
  AND NOT (SELECT public.before_system(pu) FROM public.purchases pu WHERE id = (SELECT p_edge FROM t_p))
  AND NOT (SELECT public.before_system(pu) FROM public.purchases pu WHERE id = (SELECT p_new FROM t_p));
SELECT 'old paid: no Assessment call; old try: no Payment call',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id IN ((SELECT p_old FROM t_p), (SELECT p_try FROM t_p)));
SELECT '3 days before go-live: Assessment call starting at go-live; paid now: Assessment call due 2 working hours after payment',
  (SELECT created_at = t.go AND due_at = public.add_working_hours(t.go, 2) FROM public.calls, t
   WHERE purchase_id = (SELECT p_edge FROM t_p) AND kind = 'assessment')
  AND (SELECT status = 'open' AND due_at = public.add_working_hours(now(), 2) FROM public.calls
       WHERE purchase_id = (SELECT p_new FROM t_p) AND kind = 'assessment');
INSERT INTO public.calls (purchase_id, kind, created_at, due_at) SELECT p_old, 'assessment', now(), now() FROM t_p;
SELECT 'even a direct insert makes no call for an old purchase',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p_old FROM t_p));

-- Old and new complete their assessments now (after go-live).
SELECT public.create_paid_attempt(v.client, 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), 'offline_' || v.pay, now(), 'en') IS NOT NULL AS attempt
FROM (VALUES ('5eed0000-0000-4000-8000-0000000f00c1'::uuid, '5eed0000-0000-4000-8000-0000000f0001'),
             ('5eed0000-0000-4000-8000-0000000f00c3'::uuid, '5eed0000-0000-4000-8000-0000000f0003')) AS v(client, pay);
UPDATE public.payments p SET attempt_id = a.id FROM public.attempts a
WHERE a.payment_ref = 'offline_' || p.id AND p.id IN ('5eed0000-0000-4000-8000-0000000f0001', '5eed0000-0000-4000-8000-0000000f0003');
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now()
WHERE client_id IN ('5eed0000-0000-4000-8000-0000000f00c1', '5eed0000-0000-4000-8000-0000000f00c3');
UPDATE public.attempts SET status = 'completed', completed_at = now()
WHERE client_id IN ('5eed0000-0000-4000-8000-0000000f00c1', '5eed0000-0000-4000-8000-0000000f00c3');
SELECT public.calls_sync() >= 0 AS synced_again;

SELECT 'completed after go-live: old gets no Booking call; new gets one',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p_old FROM t_p))
  AND EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p_new FROM t_p) AND kind = 'booking' AND status = 'open');
SELECT pg_temp.login('counsellor2@example.com') AS as_c2_before;
SET LOCAL ROLE authenticated;
SELECT 'before any booking the counsellor does not see the old client',
  NOT EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000000f00c1');
RESET ROLE;
SELECT 'an old purchase can be booked into a slot by hand (its coordinator); still no automatic Booking call',
  public.presentation_book((SELECT p_old FROM t_p), (SELECT c2 FROM t), (SELECT day FROM t), '11:00',
                           (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p_old FROM t_p))) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p_old FROM t_p));
SELECT 'journey of the booked old purchase: Report presentation planned = the slot',
  (SELECT planned_at = (t.day + time '11:00') AT TIME ZONE 'Asia/Kolkata' AND status = 'open'
   FROM public.purchase_stages, t WHERE purchase_id = (SELECT p_old FROM t_p) AND stage = 'report_presentation');
SELECT public.presentation_book((SELECT p_new FROM t_p), c2, day, '10:00', admin) IS NOT NULL AS booked_new_with_c2 FROM t;

SELECT pg_temp.login('counsellor2@example.com') AS as_c2;
SET LOCAL ROLE authenticated;
SELECT 'the counsellor sees the clients booked with them (new and old), not the unbooked one',
  EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000000f00c3')
  AND EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000000f00c1')
  AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000000f00c2');
RESET ROLE;
SELECT pg_temp.login('superadmin@example.com') AS as_admin;
SET LOCAL ROLE authenticated;
SELECT 'a super admin sees the old client and their assessment',
  EXISTS (SELECT 1 FROM public.clients WHERE id = '5eed0000-0000-4000-8000-0000000f00c1')
  AND EXISTS (SELECT 1 FROM public.attempts WHERE client_id = '5eed0000-0000-4000-8000-0000000f00c1');
RESET ROLE;

-- The booked old presentation is marked done (as a super admin, any time): the Package call is made, as usual.
SELECT public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT p_old FROM t_p) AND status = 'booked'),
                                     (SELECT admin FROM t))::text = '' AS old_presentation_done;
SELECT 'old purchase after its presentation: Package call open, package offer for the client; no other call',
  (SELECT count(*) = 1 AND bool_and(kind = 'package' AND status = 'open') FROM public.calls WHERE purchase_id = (SELECT p_old FROM t_p))
  AND (SELECT count(*) = 1 FROM public.package_offers_for_client('5eed0000-0000-4000-8000-0000000f00c1'));
SELECT 'no Payment, Assessment or Booking call from before the system is open (nothing late in My tasks or Purchases)',
  NOT EXISTS (SELECT 1 FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
              WHERE c.status = 'open' AND c.kind <> 'package' AND public.before_system(pu));

ROLLBACK;

-- STAGING ONLY. Behaviour test: a purchase is FINISHED when its Assessment, Booking or Package call is closed as Not
-- interested (owner, 2026-11-23). One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-purchase-finished.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin;

-- A client with a paid purchase (manual payment); p_stage: 0 = paid only, 1 = assessment completed, 2 = presentation done.
CREATE FUNCTION pg_temp.purchase(p_n int, p_stage int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_client uuid := ('5eed0000-0000-4000-8000-0000000e10c' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-0000000e100' || p_n)::uuid;
  v_ref text := 'offline_e' || p_n;
  v_purchase uuid;
BEGIN
  INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
  VALUES (v_client, '+91999990081' || p_n, 'Finished Test ' || p_n, 'Female', 30, 'Single');
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method,
                               reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
  SELECT v_pay, '+91999990081' || p_n, 'IA', 'offline', 350000, 'paid', v_ref, v_ref, now(), 'upi', 'UPI-FIN-' || p_n, admin,
         'fake-proof', 'https://drive.example/fake-proof', v_client, now() FROM t;
  SELECT purchase_id INTO v_purchase FROM public.purchase_payments WHERE payment_id = v_pay;
  IF p_stage >= 1 THEN
    PERFORM public.create_paid_attempt(v_client, 'IA', (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
    UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE id = v_pay;
    UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
    UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  END IF;
  IF p_stage >= 2 THEN
    PERFORM public.presentation_book(v_purchase, f.counsellor_id, f.on_date, f.start_time, (SELECT admin FROM t))
    FROM (SELECT * FROM public.free_presentation_slots(current_date, public.booking_last_day()) ORDER BY on_date, start_time LIMIT 1) f;
    PERFORM public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = v_purchase AND status = 'booked'),
                                          (SELECT admin FROM t));
  END IF;
  RETURN v_purchase;
END;
$$;
-- Not picked, Talked to client (follow-ups), then Not interested on the purchase's call of this kind.
CREATE FUNCTION pg_temp.not_interested(p_purchase uuid, p_kind text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_call uuid := (SELECT id FROM public.calls WHERE purchase_id = p_purchase AND kind = p_kind);
BEGIN
  PERFORM public.call_mark(v_call, (SELECT admin FROM t), 'not_picked', null, null, public.add_working_hours(now(), 1));
  PERFORM public.call_mark(v_call, (SELECT admin FROM t), 'talked', null, null, public.add_working_hours(now(), 2));
  PERFORM public.call_mark(v_call, (SELECT admin FROM t), 'not_interested', 'not_now', null, null);
END;
$$;
CREATE FUNCTION pg_temp.is_open(p_n int) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.purchase_open_for('+91999990081' || p_n, 'IA'));
$$;
CREATE FUNCTION pg_temp.new_try(p_n int) RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.payments (phone, test_code, amount_paise, currency, provider_order_id)
  VALUES ('+91999990081' || p_n, 'IA', 350000, 'INR', 'order_fin_' || p_n || '_' || gen_random_uuid());
  RETURN (SELECT count(*) FROM public.purchases WHERE phone = '+91999990081' || p_n AND kind = 'assessment');
END;
$$;

SELECT 'test numbers unused', NOT EXISTS (SELECT 1 FROM public.payments WHERE phone LIKE '+91999990081_');
CREATE TEMP TABLE p ON COMMIT DROP AS
SELECT pg_temp.purchase(1, 0) AS p1, pg_temp.purchase(2, 1) AS p2, pg_temp.purchase(3, 2) AS p3, pg_temp.purchase(4, 0) AS p4;

SELECT 'all four start open', pg_temp.is_open(1) AND pg_temp.is_open(2) AND pg_temp.is_open(3) AND pg_temp.is_open(4);

SELECT pg_temp.not_interested((SELECT p1 FROM p), 'assessment');
SELECT pg_temp.not_interested((SELECT p2 FROM p), 'booking');
SELECT pg_temp.not_interested((SELECT p3 FROM p), 'package');
SELECT public.call_mark((SELECT id FROM public.calls WHERE purchase_id = (SELECT p4 FROM p) AND kind = 'assessment'),
                        (SELECT admin FROM t), 'not_picked', null, null, public.add_working_hours(now(), 1))::text = '' AS followed_up;

SELECT 'Not interested on the Assessment, Booking or Package call: finished',
  NOT pg_temp.is_open(1) AND NOT pg_temp.is_open(2) AND NOT pg_temp.is_open(3);
SELECT 'only followed up (Not picked): still open', pg_temp.is_open(4);
SELECT 'a new try from a finished number starts a new purchase (2 rows); from an open one it joins as history (1 row)',
  pg_temp.new_try(1) = 2 AND pg_temp.new_try(2) = 2 AND pg_temp.new_try(3) = 2 AND pg_temp.new_try(4) = 1;
SELECT 'the finished purchases stay as they are (Paid; the package offer is still there)',
  (SELECT bool_and(status = 'paid') FROM public.purchases WHERE id IN ((SELECT p1 FROM p), (SELECT p2 FROM p), (SELECT p3 FROM p)))
  AND EXISTS (SELECT 1 FROM public.package_offer((SELECT p3 FROM p)));

ROLLBACK;

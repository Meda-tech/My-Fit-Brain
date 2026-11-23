-- STAGING ONLY. Behaviour test: a package paid after the purchase was closed (owner, 2026-11-23).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-package-after-close.sql

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

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;

-- A client whose report presentation is done (the package offer exists); returns the assessment purchase.
CREATE FUNCTION pg_temp.offer(p_n int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_client uuid := ('5eed0000-0000-4000-8000-0000000d10c' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-0000000d100' || p_n)::uuid;
  v_ref text := 'offline_d' || p_n;
  v_purchase uuid;
BEGIN
  INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
  VALUES (v_client, '+91999990071' || p_n, 'Late Package ' || p_n, 'Female', 30, 'Single');
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method,
                               reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
  SELECT v_pay, '+91999990071' || p_n, 'IA', 'offline', 350000, 'paid', v_ref, v_ref, now(), 'upi', 'UPI-LATE-' || p_n, admin,
         'fake-proof', 'https://drive.example/fake-proof', v_client, now() FROM t;
  PERFORM public.create_paid_attempt(v_client, 'IA', (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
  UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE id = v_pay;
  UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
  UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  SELECT purchase_id INTO v_purchase FROM public.purchase_payments WHERE payment_id = v_pay;
  PERFORM public.presentation_book(v_purchase, f.counsellor_id, f.on_date, f.start_time, (SELECT admin FROM t))
  FROM (SELECT * FROM public.free_presentation_slots(current_date, public.booking_last_day()) ORDER BY on_date, start_time LIMIT 1) f;
  PERFORM public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = v_purchase AND status = 'booked'),
                                        (SELECT admin FROM t));
  RETURN v_purchase;
END;
$$;
CREATE FUNCTION pg_temp.pay_package(p_purchase uuid) RETURNS text LANGUAGE sql AS $$
  SELECT public.package_payment_manual(gen_random_uuid(), p_purchase, (SELECT admin FROM t), 'upi', 'UPI-PKG-LATE', null, now(),
                                       'fake-proof-pkg', 'https://drive.example/fake-proof-pkg');
$$;

SELECT 'test numbers unused', NOT EXISTS (SELECT 1 FROM public.payments WHERE phone LIKE '+91999990071_');

CREATE TEMP TABLE p ON COMMIT DROP AS SELECT pg_temp.offer(1) AS closed_one, pg_temp.offer(2) AS open_one;
SELECT public.purchase_close((SELECT closed_one FROM p), 'Client said no to the package', (SELECT admin FROM t))::text = '' AS closed;

SELECT '1. the package offer stays after Close purchase',
  EXISTS (SELECT 1 FROM public.package_offer((SELECT closed_one FROM p)))
  AND (SELECT status = 'closed' AND outcome = 'purchase_closed' FROM public.calls WHERE purchase_id = (SELECT closed_one FROM p) AND kind = 'package');

SELECT pg_temp.pay_package((SELECT closed_one FROM p)) = 'paid' AS package_paid;
SELECT '2. paid late: processed as usual (Package purchase made, Package call closed as paid, journey filled)',
  EXISTS (SELECT 1 FROM public.purchases WHERE parent_purchase_id = (SELECT closed_one FROM p) AND kind = 'package' AND status = 'paid')
  AND (SELECT status = 'closed' AND outcome = 'package_paid' FROM public.calls WHERE purchase_id = (SELECT closed_one FROM p) AND kind = 'package')
  AND (SELECT done_at IS NOT NULL FROM public.purchase_stages WHERE purchase_id = (SELECT closed_one FROM p) AND stage = 'package_call')
  AND (SELECT closed_reason = 'closed_by_staff' FROM public.purchases WHERE id = (SELECT closed_one FROM p));
SELECT '3. and one open task "Package paid – inform the team" on the closed purchase, due 2 working hours after payment',
  (SELECT count(*) = 1 AND bool_and(status = 'open' AND due_at = public.add_working_hours(created_at, 2))
   FROM public.calls WHERE purchase_id = (SELECT closed_one FROM p) AND kind = 'package_inform');

CREATE TEMP TABLE i ON COMMIT DROP AS SELECT id FROM public.calls WHERE purchase_id = (SELECT closed_one FROM p) AND kind = 'package_inform';
SELECT '4. it takes only Done',
  pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''call_later'', null, null, %L)', (SELECT id FROM i), (SELECT admin FROM t),
                            public.add_working_hours(now(), 1)), 'Choose what happened on the call.')
  AND pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', ''other'', null, null)', (SELECT id FROM i), (SELECT admin FROM t)),
                         'Choose what happened on the call.');
SELECT public.call_mark((SELECT id FROM i), (SELECT admin FROM t), 'done', null, 'Told the team', null)::text = '' AS marked;
SELECT '5. Done closes it',
  (SELECT status = 'closed' AND outcome = 'done' FROM public.calls WHERE id = (SELECT id FROM i));

SELECT pg_temp.pay_package((SELECT open_one FROM p)) = 'paid' AS package_paid_open;
SELECT '6. a package paid on a purchase that is not closed makes no such task',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT open_one FROM p) AND kind = 'package_inform');

SELECT '7. a closed purchase still gets no other new call',
  NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT closed_one FROM p) AND status = 'open');

ROLLBACK;

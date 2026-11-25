-- STAGING ONLY. Six fake clients at the Package call stage, for testing package part payments and the CRM page
-- (step of 2026-11-24):
--   Riya Test +91 99999 00061 · Sana Test +91 99999 00062 · Tara Test +91 99999 00063 · Uma Test +91 99999 00064
--   Veda Test +91 99999 00065 · Zoya Test +91 99999 00066
-- Each: a paid IA (manual payment with a fake proof link), assessment completed, presentation booked and marked done
-- → Package call open, nothing paid for the package yet (₹31,500 to pay). ADDS ROWS ONLY, keeps them (not rolled
-- back); running it again changes nothing.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-part-payments-setup.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE FUNCTION pg_temp.package_client(p_n int, p_name text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_admin uuid := (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com');
  v_client uuid := ('5eed0000-0000-4000-8000-00000007c00' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-00000007a00' || p_n)::uuid;
  v_phone text := '+91999990006' || p_n;
  v_ref text := 'offline_' || v_pay;
  v_purchase uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.clients WHERE id = v_client) THEN
    RETURN p_name || ': already there';
  END IF;
  INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status, city, state)
  VALUES (v_client, v_phone, p_name, 'Female', 31, 'Married', 'Hisar', 'Haryana');
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method,
                               reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
  VALUES (v_pay, v_phone, 'IA', 'offline', 350000, 'paid', v_ref, v_ref, now(), 'upi', 'UPI-PART-SETUP-' || p_n, v_admin,
          'fake-proof-part-' || p_n, 'https://drive.example/fake-proof-part-' || p_n, v_client, now());
  PERFORM public.create_paid_attempt(v_client, 'IA', (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
  UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE id = v_pay;
  UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
  UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  SELECT purchase_id INTO v_purchase FROM public.purchase_payments WHERE payment_id = v_pay;
  PERFORM public.presentation_book(v_purchase, f.counsellor_id, f.on_date, f.start_time, v_admin)
  FROM (SELECT * FROM public.free_presentation_slots(current_date + 1, current_date + 29)
        -- counsellor@example.com first: the older behaviour tests expect counsellor2@ to have no clients.
        ORDER BY (counsellor_id = (SELECT id FROM public.profiles WHERE email = 'counsellor@example.com')) DESC, on_date, start_time LIMIT 1) f;
  PERFORM public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = v_purchase AND status = 'booked'), v_admin);
  RETURN p_name || ': created, purchase ' || v_purchase;
END;
$$;

SELECT pg_temp.package_client(1, 'Riya Test');
SELECT pg_temp.package_client(2, 'Sana Test');
SELECT pg_temp.package_client(3, 'Tara Test');
SELECT pg_temp.package_client(4, 'Uma Test');
SELECT pg_temp.package_client(5, 'Veda Test');
SELECT pg_temp.package_client(6, 'Zoya Test');

COMMIT;

SELECT c.full_name, c.phone, (SELECT p.email FROM public.profiles p WHERE p.id = pu.coordinator_id) AS coordinator,
       b.total_paise / 100 AS package_rupees, b.paid_paise / 100 AS paid_rupees, b.started,
       (SELECT status FROM public.calls WHERE purchase_id = pu.id AND kind = 'package') AS package_call
FROM public.clients c JOIN public.purchases pu ON pu.client_id = c.id AND pu.kind = 'assessment'
LEFT JOIN LATERAL public.package_balance(pu.id) b ON true
WHERE c.phone IN ('+919999900061', '+919999900062', '+919999900063', '+919999900064', '+919999900065', '+919999900066') ORDER BY c.phone;

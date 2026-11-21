-- STAGING ONLY. Two fake clients at the package-offer stage, for the step 6 end-to-end checks:
--   Pooja Test +91 99999 00006 (Razorpay test-mode payment)  ·  Kiran Test +91 99999 00007 (manual payment with proof)
-- Each: a paid IA (manual payment with a fake proof link), assessment completed, presentation booked and marked done
-- → Package call open, offer ₹31,500. ADDS ROWS ONLY, keeps them (not rolled back); running it again changes nothing.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-e2e-package-setup.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE FUNCTION pg_temp.offer_client(p_n int, p_name text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_admin uuid := (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com');
  v_client uuid := ('5eed0000-0000-4000-8000-00000006c00' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-00000006a00' || p_n)::uuid;
  v_phone text := '+91999990000' || p_n;
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
  VALUES (v_pay, v_phone, 'IA', 'offline', 350000, 'paid', v_ref, v_ref, now(), 'upi', 'UPI-E2E-PKG-' || p_n, v_admin,
          'fake-proof-e2e-' || p_n, 'https://drive.example/fake-proof-e2e-' || p_n, v_client, now());
  PERFORM public.create_paid_attempt(v_client, 'IA', (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
  UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE id = v_pay;
  UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
  UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  SELECT purchase_id INTO v_purchase FROM public.purchase_payments WHERE payment_id = v_pay;
  PERFORM public.presentation_book(v_purchase, f.counsellor_id, f.on_date, f.start_time, v_admin)
  FROM (SELECT * FROM public.free_presentation_slots(current_date + 1, current_date + 29) ORDER BY on_date, start_time LIMIT 1) f;
  PERFORM public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = v_purchase AND status = 'booked'), v_admin);
  RETURN p_name || ': created, purchase ' || v_purchase;
END;
$$;

SELECT pg_temp.offer_client(6, 'Pooja Test');
SELECT pg_temp.offer_client(7, 'Kiran Test');

COMMIT;

SELECT c.full_name, c.phone, pu.id AS purchase_id, o.amount_paise / 100 AS to_pay_rupees,
       (SELECT status FROM public.calls WHERE purchase_id = pu.id AND kind = 'package') AS package_call
FROM public.clients c JOIN public.purchases pu ON pu.client_id = c.id AND pu.kind = 'assessment'
LEFT JOIN LATERAL public.package_offer(pu.id) o ON true
WHERE c.phone IN ('+919999900006', '+919999900007') ORDER BY c.phone;

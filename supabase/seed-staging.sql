-- ==============================================================================
-- STAGING ONLY — fake test data. NEVER run this on production.
-- ==============================================================================
-- Run it with:  powershell -File supabase/staging-migrate.ps1 -Run supabase/seed-staging.sql
-- (psql only: it reads the questionnaire JSON files and the staff password from the environment.)
--
-- Adds (safe to run again; existing rows are left as they are):
--   * 3 staff logins (email + password STAGING_STAFF_PASSWORD from supabase/.env.db):
--       superadmin@example.com (super_admin), coordinator@example.com, counsellor@example.com
--   * the questionnaires IA and MA, version 1 of each published from docs/questionnaires/*.json
--   * 3 fake clients (+91 99999 00001..3) and fake purchases:
--       Asha  — paid, not started (Home shows Start)
--       Rahul — one failed payment, one offline UPI payment (paid, not started)
--       Meera — registered, nothing bought
--       +91 99999 00005 — paid on the pay link, never logged in (claimed at the first login)
-- Deletes nothing. Stops if the database holds any client or purchase that is not one of these fakes.
-- ==============================================================================

\set ON_ERROR_STOP on
\getenv staff_password STAGING_STAFF_PASSWORD
\set ia_json `cat /repo/docs/questionnaires/intimacy.json`
\set ma_json `cat /repo/docs/questionnaires/mind.json`

BEGIN;

-- 0. Safety: this must be a test database.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.clients WHERE phone !~ '^\+9199999000\d{2}$')
     OR EXISTS (SELECT 1 FROM public.payments WHERE provider_order_id NOT LIKE '%STAGINGFAKE%') THEN
    RAISE EXCEPTION 'This database holds real-looking clients or payments. The staging seed stops here.';
  END IF;
END $$;

-- \g /dev/null: never print the password or the JSON.
SELECT set_config('seed.staff_password', :'staff_password', true) \g /dev/null
SELECT set_config('seed.ia', :'ia_json', true) \g /dev/null
SELECT set_config('seed.ma', :'ma_json', true) \g /dev/null

DO $$
BEGIN
  IF length(coalesce(current_setting('seed.staff_password', true), '')) < 8 THEN
    RAISE EXCEPTION 'STAGING_STAFF_PASSWORD is missing or shorter than 8 characters.';
  END IF;
END $$;

-- 1. Staff logins (auth users with email + password, then their profiles).
WITH staff(id, email, full_name, role) AS (VALUES
  ('5eed0000-0000-4000-8000-000000000001'::uuid, 'superadmin@example.com',  'Test Super Admin', 'super_admin'),
  ('5eed0000-0000-4000-8000-000000000002'::uuid, 'coordinator@example.com', 'Test Coordinator', 'coordinator'),
  ('5eed0000-0000-4000-8000-000000000003'::uuid, 'counsellor@example.com',  'Test Counsellor',  'counsellor')
), u AS (
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  SELECT '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
         extensions.crypt(current_setting('seed.staff_password'), extensions.gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', full_name), now(), now(),
         '', '', '', ''
  FROM staff
  ON CONFLICT (id) DO NOTHING
  RETURNING id, email
)
INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
FROM u;

INSERT INTO public.profiles (id, auth_user_id, email, full_name, role, is_active)
VALUES
  ('5eed0000-0000-4000-8000-000000000101', '5eed0000-0000-4000-8000-000000000001', 'superadmin@example.com',  'Test Super Admin', 'super_admin', true),
  ('5eed0000-0000-4000-8000-000000000102', '5eed0000-0000-4000-8000-000000000002', 'coordinator@example.com', 'Test Coordinator', 'coordinator', true),
  ('5eed0000-0000-4000-8000-000000000103', '5eed0000-0000-4000-8000-000000000003', 'counsellor@example.com',  'Test Counsellor',  'counsellor',  true)
ON CONFLICT (id) DO NOTHING;

-- 2. Questionnaires and their first version, published like Admin → Publish does.
INSERT INTO public.questionnaires (code, name_en, name_hi, report_prefix, sort) VALUES
  ('IA', 'MFB Intimacy Assessment', 'MFB इंटिमेसी असेसमेंट', 'MFB-IA', 1),
  ('MA', 'MFB Mind Assessment', 'MFB माइंड असेसमेंट', 'MFB-MA', 2)
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
  q record;
  v_id uuid;
BEGIN
  FOR q IN SELECT * FROM (VALUES ('IA', current_setting('seed.ia')::jsonb), ('MA', current_setting('seed.ma')::jsonb)) AS t(code, definition) LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.questionnaire_versions WHERE questionnaire_code = q.code);
    INSERT INTO public.questionnaire_versions (questionnaire_code, number, status, definition, created_by)
    VALUES (q.code, 1, 'draft', q.definition, '5eed0000-0000-4000-8000-000000000101')
    RETURNING id INTO v_id;
    PERFORM public.publish_questionnaire_version(v_id, '5eed0000-0000-4000-8000-000000000101');
    IF q.definition ? 'client_details' THEN
      UPDATE public.questionnaires SET client_details = q.definition->'client_details' WHERE code = q.code;
    END IF;
  END LOOP;
END $$;

-- 3. Fake clients (no logins yet: the first OTP login links them by phone).
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status, city, state, email) VALUES
  ('5eed0000-0000-4000-8000-000000000201', '+919999900001', 'Asha Test',  'Female', 29, 'Married',           'Pune',   'Maharashtra', 'asha.test@example.com'),
  ('5eed0000-0000-4000-8000-000000000202', '+919999900002', 'Rahul Test', 'Male',   34, 'In a relationship', 'Jaipur', 'Rajasthan',   'rahul.test@example.com'),
  ('5eed0000-0000-4000-8000-000000000203', '+919999900003', 'Meera Test', 'Female', 41, 'Divorced',          'Indore', 'Madhya Pradesh', NULL)
ON CONFLICT (id) DO NOTHING;

-- 4. Fake purchases (₹3,500 = 350000 paise). Order ids carry STAGINGFAKE so they are easy to spot.
INSERT INTO public.payments (id, client_id, claimed_at, phone, test_code, provider, amount_paise, status,
                             provider_order_id, provider_payment_id, method, paid_at, failure_code, failure_reason)
VALUES
  ('5eed0000-0000-4000-8000-000000000301', '5eed0000-0000-4000-8000-000000000201', now(), '+919999900001', 'IA', 'razorpay', 350000, 'paid',
   'order_STAGINGFAKE01', 'pay_STAGINGFAKE01', 'upi', now() - interval '2 days', NULL, NULL),
  ('5eed0000-0000-4000-8000-000000000302', '5eed0000-0000-4000-8000-000000000202', now(), '+919999900002', 'MA', 'razorpay', 350000, 'failed',
   'order_STAGINGFAKE02', NULL, NULL, NULL, 'BAD_REQUEST_ERROR', 'Fake failed payment (staging)'),
  ('5eed0000-0000-4000-8000-000000000304', NULL, NULL, '+919999900005', 'IA', 'razorpay', 350000, 'paid',
   'order_STAGINGFAKE04', 'pay_STAGINGFAKE04', 'card', now() - interval '1 day', NULL, NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payments (id, client_id, claimed_at, phone, test_code, provider, amount_paise, status,
                             provider_order_id, provider_payment_id, method, paid_at, reference, note,
                             recorded_by, proof_file_id, proof_url)
VALUES
  ('5eed0000-0000-4000-8000-000000000303', '5eed0000-0000-4000-8000-000000000202', now(), '+919999900002', 'MA', 'offline', 350000, 'paid',
   'offline_STAGINGFAKE03', 'offline_STAGINGFAKE03', 'upi', now() - interval '3 hours', 'FAKEUPI000123', 'Fake offline payment (staging)',
   '5eed0000-0000-4000-8000-000000000102', 'fake-proof-file', 'https://example.com/fake-proof')
ON CONFLICT (id) DO NOTHING;

COMMIT;

\echo 'Staging seed done.'
SELECT 'staff' AS what, count(*) FROM public.profiles
UNION ALL SELECT 'questionnaires live', count(*) FROM public.questionnaire_versions WHERE status = 'live'
UNION ALL SELECT 'clients', count(*) FROM public.clients
UNION ALL SELECT 'payments', count(*) FROM public.payments;

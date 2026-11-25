-- STAGING ONLY — two fake CRM logins for testing the CRM role (step of 2026-11-24). NEVER run this on production:
-- on production a super admin adds CRM staff in Admin → Team.
-- Run it with:  powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-add-crm-logins.sql
-- (after 20261124000000_package_part_payments_crm.sql; psql only: it reads the staff password from the environment.)
--
-- Adds (safe to run again; existing rows are left as they are): crm@example.com and crm2@example.com, role CRM,
-- password = STAGING_STAFF_PASSWORD from supabase/.env.db. Deletes nothing.

\set ON_ERROR_STOP on
\getenv staff_password STAGING_STAFF_PASSWORD

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

-- \g /dev/null: never print the password.
SELECT set_config('seed.staff_password', :'staff_password', true) \g /dev/null
DO $$
BEGIN
  IF length(coalesce(current_setting('seed.staff_password', true), '')) < 8 THEN
    RAISE EXCEPTION 'STAGING_STAFF_PASSWORD is missing or shorter than 8 characters.';
  END IF;
END $$;

WITH staff(id, email, full_name) AS (VALUES
  ('5eed0000-0000-4000-8000-000000000008'::uuid, 'crm@example.com',  'Test CRM'),
  ('5eed0000-0000-4000-8000-000000000007'::uuid, 'crm2@example.com', 'Test CRM Two')
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
  ('5eed0000-0000-4000-8000-000000000108', '5eed0000-0000-4000-8000-000000000008', 'crm@example.com',  'Test CRM',     'crm', true),
  ('5eed0000-0000-4000-8000-000000000107', '5eed0000-0000-4000-8000-000000000007', 'crm2@example.com', 'Test CRM Two', 'crm', true)
ON CONFLICT (id) DO NOTHING;

SELECT email, role, is_active FROM public.profiles WHERE role = 'crm' ORDER BY email;

COMMIT;

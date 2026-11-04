-- STAGING ONLY. Sets the three fake staff logins (superadmin/coordinator/counsellor@example.com) to the
-- password STAGING_STAFF_PASSWORD from supabase/.env.db. Changes nothing else; deletes nothing.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging-reset-staff-password.sql

\set ON_ERROR_STOP on
\getenv staff_password STAGING_STAFF_PASSWORD

BEGIN;
SELECT set_config('seed.staff_password', :'staff_password', true) \g /dev/null
DO $$
BEGIN
  IF length(coalesce(current_setting('seed.staff_password', true), '')) < 8 THEN
    RAISE EXCEPTION 'STAGING_STAFF_PASSWORD is missing or shorter than 8 characters.';
  END IF;
END $$;
UPDATE auth.users
SET encrypted_password = extensions.crypt(current_setting('seed.staff_password'), extensions.gen_salt('bf')), updated_at = now()
WHERE email IN ('superadmin@example.com', 'coordinator@example.com', 'counsellor@example.com');
COMMIT;

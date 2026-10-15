-- ==============================================================================
-- MFB Assessments — First super admin (template)
-- ==============================================================================

-- There is no bootstrap page or API. The owner creates the first super admin:
-- 1. Supabase Studio -> Authentication -> Users -> Add user (email + strong password,
--    tick Auto Confirm User).
-- 2. Copy the new user's UID.
-- 3. Replace the placeholders below and run this in the SQL Editor.
-- Coordinators and counsellors are then added from the Team page in the staff portal.

/*
INSERT INTO public.profiles (
  auth_user_id,
  email,
  full_name,
  role,
  is_active
) VALUES (
  'REPLACE_WITH_SUPABASE_AUTH_UID',
  'REPLACE_WITH_SUPER_ADMIN_EMAIL',
  'REPLACE_WITH_FULL_NAME',
  'super_admin',
  true
) ON CONFLICT (email) DO UPDATE
SET role = 'super_admin', is_active = true, auth_user_id = EXCLUDED.auth_user_id;
*/

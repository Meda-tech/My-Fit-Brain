-- ==============================================================================
-- Dr Neha Mehta — Phase 1 Seed Script / Super Admin Initialization
-- ==============================================================================

-- Instructions:
-- 1. Create a user in Supabase Auth (via Supabase Studio -> Authentication -> Users -> Add user)
--    e.g. Email: superadmin@drnehamehta.com, Password: <secure-password>
-- 2. Obtain their Auth UUID from Supabase Studio.
-- 3. Replace the placeholder '00000000-0000-0000-0000-000000000000' below with that Auth UUID,
--    or execute this snippet in Supabase SQL Editor:

/*
INSERT INTO public.profiles (
  auth_user_id,
  email,
  full_name,
  role,
  is_active
) VALUES (
  'REPLACE_WITH_SUPABASE_AUTH_UID',
  'superadmin@drnehamehta.com',
  'Dr Neha Mehta (Super Admin)',
  'super_admin',
  true
) ON CONFLICT (email) DO UPDATE
SET role = 'super_admin', is_active = true, auth_user_id = EXCLUDED.auth_user_id;
*/

-- Alternatively, the system includes a self-healing bootstrap API endpoint
-- (/api/bootstrap-admin) in the /admin application that allows the owner with the
-- server-side SUPABASE_SERVICE_ROLE_KEY to initialize the first Super Admin safely!

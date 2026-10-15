-- ==============================================================================
-- MFB Assessments — Foundation (Task 02)
-- Gender and relationship options match question bank I2 / I3; adds the counsellor role.
--
-- One transaction (BEGIN ... COMMIT): paste the whole file into the Supabase SQL Editor and run.
-- If any statement fails, nothing is changed. Row counts appear as NOTICEs in the output.
-- Safe to run once on a database that already has 20261013000000_phase1_init.sql applied;
-- running it again is harmless (constraints are dropped and re-added, nothing left to remap).
-- Checks after running: docs/tasks/02-verify.sql
--
-- ROLLBACK (manual, not automatic). Run in one transaction:
--   UPDATE public.profiles SET is_active = false WHERE role = 'counsellor';  -- or reassign them first
--   UPDATE public.profiles SET role = 'coordinator' WHERE role = 'counsellor';
--   ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
--   ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
--     CHECK (role IN ('super_admin', 'coordinator'));
--   DROP FUNCTION IF EXISTS public.is_counsellor();
--   ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_gender_check;
--   UPDATE public.clients SET gender = 'Other' WHERE gender = 'Prefer not to say';
--   ALTER TABLE public.clients ADD CONSTRAINT clients_gender_check
--     CHECK (gender IN ('Female', 'Male', 'Other'));
--   ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_marital_status_check;
--   UPDATE public.clients SET marital_status = 'Other'
--     WHERE marital_status IN ('In a relationship', 'Engaged');
--   ALTER TABLE public.clients ADD CONSTRAINT clients_marital_status_check
--     CHECK (marital_status IN ('Single', 'Married', 'Divorced', 'Widowed', 'Separated', 'Other'));
--   COMMENT ON COLUMN public.clients.marital_status IS NULL;
-- Rows mapped 'Other' -> 'Single' below cannot be told apart afterwards (testing data only).
-- ==============================================================================

BEGIN;

-- 1. GENDER — question I2: Male / Female / Prefer not to say
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.clients WHERE gender = 'Other';
  RAISE NOTICE 'clients.gender: % row(s) Other -> Prefer not to say', v_count;
END;
$$;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_gender_check;

UPDATE public.clients SET gender = 'Prefer not to say' WHERE gender = 'Other';

ALTER TABLE public.clients
  ADD CONSTRAINT clients_gender_check
  CHECK (gender IN ('Male', 'Female', 'Prefer not to say'));

-- 2. RELATIONSHIP STATUS — question I3 (column name kept as marital_status)
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.clients WHERE marital_status = 'Other';
  RAISE NOTICE 'clients.marital_status: % row(s) Other -> Single', v_count;
END;
$$;

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_marital_status_check;

-- Single, Married, Separated, Divorced, Widowed keep their value.
UPDATE public.clients SET marital_status = 'Single' WHERE marital_status = 'Other';

ALTER TABLE public.clients
  ADD CONSTRAINT clients_marital_status_check
  CHECK (marital_status IN (
    'Single', 'In a relationship', 'Engaged', 'Married', 'Separated', 'Divorced', 'Widowed'
  ));

COMMENT ON COLUMN public.clients.marital_status IS 'Relationship status — matches question I3';

-- 3. ROLES — super_admin, coordinator, counsellor
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'coordinator', 'counsellor'));

COMMENT ON COLUMN public.profiles.role IS 'Staff role: super_admin, coordinator or counsellor';

-- Counsellors are active staff, so is_active_staff() already covers them and existing
-- RLS policies are unchanged. This helper is for later tasks (counsellor-only data).
CREATE OR REPLACE FUNCTION public.is_counsellor()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role = 'counsellor'
      AND is_active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_counsellor() FROM PUBLIC;
DO $$
BEGIN
  -- anon exists on Supabase; guard so the file also runs on a plain Postgres.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.is_counsellor() FROM anon;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_counsellor() TO authenticated;

COMMIT;

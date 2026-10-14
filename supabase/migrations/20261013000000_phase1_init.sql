-- ==============================================================================
-- Dr Neha Mehta — Phase 1 Database Schema & Security
-- Application Roles: super_admin, coordinator, client
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. STAFF PROFILES TABLE
-- Stable application UUIDs for staff members, mapped to Supabase auth.users(id)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'coordinator')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comments
COMMENT ON TABLE public.profiles IS 'Internal staff identity and role authorization';
COMMENT ON COLUMN public.profiles.id IS 'Stable application UUID';
COMMENT ON COLUMN public.profiles.auth_user_id IS 'Supabase Auth user mapping (nullable before invite or link)';
COMMENT ON COLUMN public.profiles.role IS 'Staff role: super_admin or coordinator';

-- 3. CLIENTS TABLE
-- Stable application UUIDs for clients, normalized phone, optional auth mapping
CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  phone text UNIQUE NOT NULL,
  full_name text NOT NULL,
  gender text NOT NULL CHECK (gender IN ('Female', 'Male', 'Other')),
  age integer NOT NULL CHECK (age >= 18 AND age <= 120),
  marital_status text NOT NULL CHECK (marital_status IN ('Single', 'Married', 'Divorced', 'Widowed', 'Separated', 'Other')),
  city text,
  state text,
  email text,
  created_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Comments
COMMENT ON TABLE public.clients IS 'Client demographics and assessment identity';
COMMENT ON COLUMN public.clients.phone IS 'Normalized E.164 phone number, unique';
COMMENT ON COLUMN public.clients.auth_user_id IS 'Supabase Auth user mapping after phone OTP verification';
COMMENT ON COLUMN public.clients.created_by_profile_id IS 'Staff member who created the record, if pre-created';

-- 4. PERFORMANCE & FOREIGN KEY INDEXES (Supabase Best Practices)
CREATE INDEX IF NOT EXISTS idx_profiles_auth_user_id ON public.profiles(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role_active ON public.profiles(role, is_active);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

CREATE INDEX IF NOT EXISTS idx_clients_auth_user_id ON public.clients(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_clients_phone ON public.clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_created_by_profile_id ON public.clients(created_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON public.clients(created_at DESC);

-- 5. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- 6. SECURITY HELPER FUNCTIONS (Avoid recursive RLS policies)
CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role = 'super_admin'
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_current_staff_profile_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles
  WHERE auth_user_id = (SELECT auth.uid())
    AND is_active = true
  LIMIT 1;
$$;

-- 7. ENABLE ROW LEVEL SECURITY
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- 8. RLS POLICIES FOR PROFILES

-- Select: A staff member can read their own profile, Super Admin can read all profiles
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth_user_id = (SELECT auth.uid())
    OR
    public.is_super_admin()
  );

-- Insert: Only Super Admin can insert profiles via client/authenticated queries
-- (Server-side privileged route handlers using service_role bypass RLS, but this safeguards authenticated client calls)
DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
  );

-- Update: Super Admin can update any profile; Staff can update own display name
DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR
    auth_user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_super_admin()
    OR
    (auth_user_id = (SELECT auth.uid()) AND role = (SELECT role FROM public.profiles WHERE auth_user_id = (SELECT auth.uid())))
  );

-- Delete: Only Super Admin can delete profiles
DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
  );

-- 9. RLS POLICIES FOR CLIENTS

-- Select:
-- 1. Active staff (Super Admin & Coordinator) can view all clients
-- 2. Client can only view their own linked record
DROP POLICY IF EXISTS "clients_select_policy" ON public.clients;
CREATE POLICY "clients_select_policy"
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    public.is_active_staff()
    OR
    auth_user_id = (SELECT auth.uid())
  );

-- Insert:
-- 1. Active staff can insert client records
-- 2. Verified client can insert their own record linked to their auth.uid()
DROP POLICY IF EXISTS "clients_insert_policy" ON public.clients;
CREATE POLICY "clients_insert_policy"
  ON public.clients
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_active_staff()
    OR
    auth_user_id = (SELECT auth.uid())
  );

-- Update:
-- 1. Active staff can update any client record
-- 2. Verified client can update their own linked record
DROP POLICY IF EXISTS "clients_update_policy" ON public.clients;
CREATE POLICY "clients_update_policy"
  ON public.clients
  FOR UPDATE
  TO authenticated
  USING (
    public.is_active_staff()
    OR
    auth_user_id = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_active_staff()
    OR
    auth_user_id = (SELECT auth.uid())
  );

-- 10. HELPER FUNCTION TO LINK OR REGISTER CLIENT SAFELY
-- Links a phone number to auth.users upon successful OTP verification without leaking data
CREATE OR REPLACE FUNCTION public.link_client_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid;
  v_client_id uuid;
  v_record RECORD;
BEGIN
  v_auth_uid := (SELECT auth.uid());
  IF v_auth_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Look for client record with normalized phone
  SELECT * INTO v_record FROM public.clients WHERE phone = p_phone LIMIT 1;

  IF FOUND THEN
    -- If already linked to another auth user, prevent takeover
    IF v_record.auth_user_id IS NOT NULL AND v_record.auth_user_id <> v_auth_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'Phone number already associated with another account');
    END IF;

    -- Link auth user ID
    UPDATE public.clients
    SET auth_user_id = v_auth_uid, updated_at = now()
    WHERE id = v_record.id;

    RETURN jsonb_build_object('success', true, 'status', 'linked', 'client_id', v_record.id);
  ELSE
    RETURN jsonb_build_object('success', true, 'status', 'needs_registration');
  END IF;
END;
$$;

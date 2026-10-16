-- ==============================================================================
-- Payments are visible to super admins and coordinators only (owner, 2026-10-16).
-- Counsellors lose read access to payments; clients still read their own payments.
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/08c-payments-access-verify.sql.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.can_view_payments()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role IN ('super_admin', 'coordinator')
      AND is_active = true
  );
$$;
COMMENT ON FUNCTION public.can_view_payments() IS 'Active super admin or coordinator: may read payments';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.can_view_payments() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.can_view_payments() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.can_view_payments() TO authenticated;
  END IF;
END;
$$;

DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated USING (
  public.can_view_payments()
  OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = payments.client_id AND c.auth_user_id = (SELECT auth.uid()))
);

COMMIT;

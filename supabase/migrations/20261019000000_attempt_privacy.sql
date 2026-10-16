-- ==============================================================================
-- Task 06 follow-up: reports and answers are for counsellors and super admins only.
--
-- Owner decision (2026-10-16): clients never see their report; coordinators do not see reports or
-- answers either. Coordinators keep attempt status and safety events (they handle crisis calls).
--
--   attempts          clients: own rows (status only, unchanged) · staff: all (unchanged)
--   attempt_answers   super_admin + counsellor only (clients and coordinators lose access)
--   attempt_results   super_admin + counsellor only (clients and coordinators lose access)
--   attempt_events    active staff (unchanged)
--
-- The apps write through the service role, which RLS does not restrict.
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/06b-privacy-verify.sql.
-- ==============================================================================

BEGIN;

-- 1. Who may read reports and raw answers.
CREATE OR REPLACE FUNCTION public.can_view_reports()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role IN ('super_admin', 'counsellor')
      AND is_active = true
  );
$$;
COMMENT ON FUNCTION public.can_view_reports() IS 'Active super admin or counsellor: may read assessment answers and results';

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.can_view_reports() FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.can_view_reports() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.can_view_reports() TO authenticated;
  END IF;
END;
$$;

-- 2. Answers and results: no client or coordinator access.
DROP POLICY IF EXISTS attempt_answers_select ON public.attempt_answers;
CREATE POLICY attempt_answers_select ON public.attempt_answers FOR SELECT TO authenticated
  USING (public.can_view_reports());

DROP POLICY IF EXISTS attempt_results_select ON public.attempt_results;
CREATE POLICY attempt_results_select ON public.attempt_results FOR SELECT TO authenticated
  USING (public.can_view_reports());

COMMIT;

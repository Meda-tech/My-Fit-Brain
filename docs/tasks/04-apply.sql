-- Task 04 — paste into the Supabase SQL Editor (testing database). Same as
-- supabase/migrations/20261017000000_qb_test_runs.sql, followed by read-only checks.

-- ==============================================================================
-- MFB Assessments — Test-case runs and the publish gate (Task 04)
--
-- Published versions are frozen (test cases included), so engine results are stored in qb_test_runs,
-- outside the freeze. qb_publish now needs, for every test case of the version, a passing run on the
-- current engine version made after the version's last content change (qb_versions.content_changed_at,
-- kept up to date by the audit trigger). qb_test_cases.verified is no longer used.
--
-- One transaction (BEGIN ... COMMIT): paste the whole file into the Supabase SQL Editor and run.
-- Run after 20261016100000_qb_rule_decisions.sql. The same SQL is in docs/tasks/04-apply.sql.
--
-- ROLLBACK (manual): DROP FUNCTION public.qb_publish(uuid, text, text), public.qb_record_test_runs(uuid, jsonb);
--   re-run the qb_publish and qb_audit definitions from 20261016000000_question_bank.sql;
--   DROP TABLE public.qb_test_runs; ALTER TABLE public.qb_versions DROP COLUMN content_changed_at;
-- ==============================================================================

BEGIN;

-- 1. WHEN A VERSION'S CONTENT LAST CHANGED
-- The volatile default gives existing rows the migration time, so they need fresh runs to publish.
ALTER TABLE public.qb_versions ADD COLUMN IF NOT EXISTS content_changed_at timestamptz NOT NULL DEFAULT now();
COMMENT ON COLUMN public.qb_versions.content_changed_at IS
  'Last change to any content, rule or test case of this version (set by qb_audit); test runs before it are stale';

COMMENT ON COLUMN public.qb_test_cases.verified IS
  'DEPRECATED (Task 04): no longer used. Results are in qb_test_runs; publishing checks those.';

-- 2. TEST RUNS (not frozen: a published version can still be re-checked with a newer engine)
CREATE TABLE IF NOT EXISTS public.qb_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  test_case_id uuid NOT NULL REFERENCES public.qb_test_cases(id) ON DELETE CASCADE,
  engine_version text NOT NULL,
  passed boolean NOT NULL,
  actual jsonb,
  diffs jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  run_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  run_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.qb_test_runs IS 'Engine results per test case; written only by qb_record_test_runs';
CREATE INDEX IF NOT EXISTS idx_qb_test_runs_case ON public.qb_test_runs (test_case_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_qb_test_runs_version ON public.qb_test_runs (version_id, run_at DESC);
CREATE INDEX IF NOT EXISTS idx_qb_test_runs_run_by ON public.qb_test_runs (run_by);

ALTER TABLE public.qb_test_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qb_test_runs_select ON public.qb_test_runs;
CREATE POLICY qb_test_runs_select ON public.qb_test_runs FOR SELECT TO authenticated USING (public.is_active_staff());
-- No write policies: rows are inserted only by qb_record_test_runs.

-- 3. RECORDING RUNS
-- p_runs: [{ "test_case_id": uuid, "engine_version": text, "passed": bool, "actual": {...}, "diffs": [...], "error": text|null }]
CREATE OR REPLACE FUNCTION public.qb_record_test_runs(p_version_id uuid, p_runs jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_bad text;
BEGIN
  IF NOT (public.qb_is_trusted_caller() OR public.can_edit_content() OR public.can_approve_content()) THEN
    RAISE EXCEPTION 'You do not have permission to record test runs.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qb_versions WHERE id = p_version_id) THEN
    RAISE EXCEPTION 'Version % not found.', p_version_id;
  END IF;
  IF jsonb_typeof(p_runs) IS DISTINCT FROM 'array' OR jsonb_array_length(p_runs) = 0 THEN
    RAISE EXCEPTION 'p_runs must be a non-empty array.';
  END IF;

  SELECT string_agg(coalesce(r ->> 'test_case_id', '(missing)'), ', ')
  INTO v_bad
  FROM jsonb_array_elements(p_runs) r
  WHERE NOT EXISTS (
    SELECT 1 FROM public.qb_test_cases tc
    WHERE tc.version_id = p_version_id AND tc.id::text = r ->> 'test_case_id'
  )
  OR coalesce(r ->> 'engine_version', '') = ''
  OR jsonb_typeof(r -> 'passed') IS DISTINCT FROM 'boolean';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid runs (unknown test case of this version, or missing engine_version / passed): %', v_bad;
  END IF;

  INSERT INTO public.qb_test_runs (version_id, test_case_id, engine_version, passed, actual, diffs, error, run_by)
  SELECT p_version_id, (r ->> 'test_case_id')::uuid, r ->> 'engine_version', (r ->> 'passed')::boolean,
         r -> 'actual', coalesce(r -> 'diffs', '[]'::jsonb), nullif(r ->> 'error', ''),
         public.get_current_staff_profile_id()
  FROM jsonb_array_elements(p_runs) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 4. AUDIT TRIGGER: also maintains content_changed_at
CREATE OR REPLACE FUNCTION public.qb_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_key jsonb := '{}'::jsonb;
  v_col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := to_jsonb(OLD);
  ELSE
    v_row := to_jsonb(NEW);
  END IF;
  -- Bookkeeping columns alone are not a change worth logging.
  IF TG_OP = 'UPDATE'
     AND to_jsonb(OLD) - 'updated_at' - 'content_changed_at' = to_jsonb(NEW) - 'updated_at' - 'content_changed_at' THEN
    RETURN NULL;
  END IF;
  IF TG_NARGS > 0 THEN
    FOREACH v_col IN ARRAY TG_ARGV LOOP
      v_key := v_key || jsonb_build_object(v_col, v_row -> v_col);
    END LOOP;
  END IF;
  INSERT INTO public.qb_audit_log (version_id, table_name, row_key, action, old, new, changed_by)
  VALUES (
    coalesce(v_row ->> 'version_id', CASE WHEN TG_TABLE_NAME = 'qb_versions' THEN v_row ->> 'id' END)::uuid,
    TG_TABLE_NAME,
    v_key,
    TG_OP,
    CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END,
    public.get_current_staff_profile_id()
  );
  -- Any content, rule or test-case change marks the (draft) version as changed, so earlier test runs
  -- become stale. Only the first change in a transaction updates the version row.
  IF TG_TABLE_NAME <> 'qb_versions' THEN
    UPDATE public.qb_versions
    SET content_changed_at = now()
    WHERE id = (v_row ->> 'version_id')::uuid
      AND content_changed_at IS DISTINCT FROM now();
  END IF;
  RETURN NULL;
END;
$$;

-- 5. PUBLISH: the old two-argument form is replaced; the engine version is now required
DROP FUNCTION IF EXISTS public.qb_publish(uuid, text);

CREATE OR REPLACE FUNCTION public.qb_publish(p_version_id uuid, p_change_note text, p_engine_version text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version public.qb_versions%ROWTYPE;
  v_cases integer;
  v_problems text;
BEGIN
  PERFORM public.qb_assert_can_approve();
  SELECT * INTO v_version FROM public.qb_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version % not found.', p_version_id;
  END IF;
  IF v_version.status <> 'in_review' THEN
    RAISE EXCEPTION 'Only a version in review can be published (this version is %).', replace(v_version.status, '_', ' ');
  END IF;
  IF coalesce(btrim(p_change_note), '') = '' THEN
    RAISE EXCEPTION 'A change note is required to publish.';
  END IF;
  PERFORM public.qb_raise_if_invalid(p_version_id);

  -- Every test case needs a passing run on this engine version, made after the last content change.
  IF coalesce(btrim(p_engine_version), '') = '' THEN
    RAISE EXCEPTION 'The engine version is required to publish.';
  END IF;
  SELECT count(*) INTO v_cases FROM public.qb_test_cases WHERE version_id = p_version_id;
  IF v_cases = 0 THEN
    RAISE EXCEPTION 'The version has no test cases; add at least one before publishing.';
  END IF;
  SELECT string_agg(x.name || ': ' || x.problem, E'\n' ORDER BY x.name)
  INTO v_problems
  FROM (
    SELECT tc.name,
      CASE
        WHEN lr.id IS NULL THEN 'not run'
        WHEN NOT lr.passed THEN 'failed'
        WHEN lr.engine_version <> p_engine_version THEN 'run on engine ' || lr.engine_version || ', not ' || p_engine_version
        WHEN lr.run_at <= v_version.content_changed_at THEN 'run before the last change'
      END AS problem
    FROM public.qb_test_cases tc
    LEFT JOIN LATERAL (
      SELECT r.* FROM public.qb_test_runs r
      WHERE r.test_case_id = tc.id
      ORDER BY r.run_at DESC, r.id DESC
      LIMIT 1
    ) lr ON true
    WHERE tc.version_id = p_version_id
  ) x
  WHERE x.problem IS NOT NULL;
  IF v_problems IS NOT NULL THEN
    RAISE EXCEPTION 'Run all test cases first; these are not passing and current:%', E'\n' || v_problems
      USING ERRCODE = '23514';
  END IF;

  PERFORM set_config('qb.workflow', 'on', true);
  UPDATE public.qb_versions
  SET status = 'retired', retired_at = now()
  WHERE test_code = v_version.test_code AND status = 'live';

  UPDATE public.qb_versions
  SET status = 'live',
      change_note = btrim(p_change_note),
      approved_by = public.get_current_staff_profile_id(),
      approved_at = now(),
      published_at = now()
  WHERE id = p_version_id;
  PERFORM set_config('qb.workflow', 'off', true);
END;
$$;

-- 6. PRIVILEGES
DO $$
DECLARE
  fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.qb_record_test_runs(uuid, jsonb)', 'public.qb_publish(uuid, text, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END IF;
  END LOOP;
END;
$$;

COMMIT;

-- ==============================================================================
-- Checks after running the above (read-only). Expect:
--   * qb_test_runs exists, RLS on, no rows yet
--   * content_changed_at filled for every version
--   * qb_publish takes (uuid, text, text); the (uuid, text) form is gone
-- ==============================================================================
select relname, relrowsecurity from pg_class where relname = 'qb_test_runs';
select count(*) as test_runs from public.qb_test_runs;
select test_code, version_label, status, content_changed_at from public.qb_versions order by test_code, created_at;
select oid::regprocedure from pg_proc where proname = 'qb_publish' and pronamespace = 'public'::regnamespace;

-- Task 06 — paste into the Supabase SQL Editor (testing database). Same as
-- supabase/migrations/20261018000000_attempts.sql, followed by read-only checks.

-- ==============================================================================
-- MFB Assessments — Attempts, answers, results, events, report IDs (Task 06)
--
-- An attempt pins the live question-bank version at payment time and keeps it for ever. Answers are
-- option codes of that version only (a trigger checks every code; no free text can be stored). Results
-- are immutable. Clients read only their own rows; every write goes through server actions using the
-- service role after an ownership check. attempt_events records crisis / safety / age-stop moments for
-- Task 08 (notifications).
--
-- One transaction (BEGIN ... COMMIT): paste the whole file into the Supabase SQL Editor and run.
-- Run after 20261017000000_qb_test_runs.sql. The same SQL is in docs/tasks/06-apply.sql.
--
-- ROLLBACK (manual, before any real data):
--   DROP TABLE public.attempt_events, public.attempt_results, public.attempt_answers, public.attempts,
--     public.report_counters CASCADE;
--   DROP FUNCTION public.next_report_id(text), public.attempt_guard(), public.attempt_answer_guard(),
--     public.attempt_result_guard();
-- ==============================================================================

BEGIN;

-- 1. REPORT IDS: MFB-IA-2026-00001, per test per year (India time), concurrency-safe.
CREATE TABLE IF NOT EXISTS public.report_counters (
  test_code text NOT NULL REFERENCES public.qb_tests(code),
  year integer NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (test_code, year)
);
ALTER TABLE public.report_counters ENABLE ROW LEVEL SECURITY;
-- No policies: only next_report_id() touches it.

CREATE OR REPLACE FUNCTION public.next_report_id(p_test_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_year integer := extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::integer;
  v_number integer;
BEGIN
  SELECT report_id_prefix INTO v_prefix FROM public.qb_tests WHERE code = p_test_code;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown test %.', p_test_code;
  END IF;
  -- One statement: the row lock makes concurrent calls take consecutive numbers.
  INSERT INTO public.report_counters AS c (test_code, year, last_number)
  VALUES (p_test_code, v_year, 1)
  ON CONFLICT (test_code, year) DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_prefix || '-' || v_year || '-' || lpad(v_number::text, 5, '0');
END;
$$;

-- 2. ATTEMPTS
CREATE TABLE IF NOT EXISTS public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id text UNIQUE,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  test_code text NOT NULL REFERENCES public.qb_tests(code),
  version_id uuid NOT NULL REFERENCES public.qb_versions(id),
  kind text NOT NULL DEFAULT 'initial' CHECK (kind IN ('initial', 'progress')),
  parent_attempt_id uuid REFERENCES public.attempts(id),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'in_progress', 'completed', 'stopped')),
  report_language text CHECK (report_language IN ('en', 'hi', 'both')),
  consent_at timestamptz,
  payment_mode text NOT NULL CHECK (payment_mode IN ('stub', 'live')),
  payment_ref text,
  paid_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  engine_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.attempts IS 'One paid assessment; version_id is the live version at payment and never changes';
CREATE INDEX IF NOT EXISTS idx_attempts_client ON public.attempts (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_version ON public.attempts (version_id);
CREATE INDEX IF NOT EXISTS idx_attempts_test ON public.attempts (test_code);
CREATE INDEX IF NOT EXISTS idx_attempts_parent ON public.attempts (parent_attempt_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON public.attempts (status);

DROP TRIGGER IF EXISTS trg_attempts_updated_at ON public.attempts;
CREATE TRIGGER trg_attempts_updated_at BEFORE UPDATE ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Identity never changes; completed and stopped attempts are final.
CREATE OR REPLACE FUNCTION public.attempt_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Attempts are never deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.test_code IS DISTINCT FROM OLD.test_code
     OR NEW.version_id IS DISTINCT FROM OLD.version_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR (OLD.report_id IS NOT NULL AND NEW.report_id IS DISTINCT FROM OLD.report_id) THEN
    RAISE EXCEPTION 'An attempt''s client, test, version, kind and report ID never change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status IN ('completed', 'stopped') AND to_jsonb(NEW) - 'updated_at' <> to_jsonb(OLD) - 'updated_at' THEN
    RAISE EXCEPTION 'This attempt is % and can no longer change.', OLD.status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attempts_guard ON public.attempts;
CREATE TRIGGER trg_attempts_guard BEFORE UPDATE OR DELETE ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.attempt_guard();

-- 3. ANSWERS: option codes of the pinned version only; locked once the attempt is completed.
CREATE TABLE IF NOT EXISTS public.attempt_answers (
  attempt_id uuid NOT NULL REFERENCES public.attempts(id),
  qid text NOT NULL,
  value jsonb NOT NULL CHECK (jsonb_typeof(value) IN ('string', 'array')),
  source text NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'profile')),
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, qid)
);
COMMENT ON TABLE public.attempt_answers IS 'Option codes only (checked against the pinned version); never free text';

CREATE OR REPLACE FUNCTION public.attempt_answer_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.attempts%ROWTYPE;
  v_codes text[];
  v_type text;
BEGIN
  SELECT * INTO v_attempt FROM public.attempts
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.attempt_id ELSE NEW.attempt_id END;
  IF v_attempt.status = 'completed' THEN
    RAISE EXCEPTION 'Answers of a completed attempt can no longer change.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF v_attempt.status = 'stopped' THEN
    RAISE EXCEPTION 'This attempt was stopped; no answers are kept.' USING ERRCODE = '42501';
  END IF;

  SELECT type INTO v_type FROM public.qb_questions WHERE version_id = v_attempt.version_id AND qid = NEW.qid;
  IF v_type IS NULL THEN
    RAISE EXCEPTION 'Question % is not in this attempt''s version.', NEW.qid USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW.value) = 'array' THEN
    IF v_type <> 'multi' OR jsonb_array_length(NEW.value) = 0 THEN
      RAISE EXCEPTION 'Question % takes a single option code.', NEW.qid USING ERRCODE = '23514';
    END IF;
    SELECT array_agg(x) INTO v_codes FROM jsonb_array_elements_text(NEW.value) x;
  ELSE
    IF v_type = 'multi' THEN
      RAISE EXCEPTION 'Question % takes a list of option codes.', NEW.qid USING ERRCODE = '23514';
    END IF;
    v_codes := ARRAY[NEW.value #>> '{}'];
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_codes) c
    WHERE NOT EXISTS (
      SELECT 1 FROM public.qb_options o
      WHERE o.version_id = v_attempt.version_id AND o.qid = NEW.qid AND o.option_code = c
    )
  ) THEN
    RAISE EXCEPTION 'An answer to % is not an option of the question.', NEW.qid USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_attempt_answers_guard ON public.attempt_answers;
CREATE TRIGGER trg_attempt_answers_guard BEFORE INSERT OR UPDATE OR DELETE ON public.attempt_answers
  FOR EACH ROW EXECUTE FUNCTION public.attempt_answer_guard();

-- 4. RESULTS: immutable once written.
CREATE TABLE IF NOT EXISTS public.attempt_results (
  attempt_id uuid PRIMARY KEY REFERENCES public.attempts(id),
  result jsonb NOT NULL,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.attempt_results IS 'Engine result and the resolved report; never updated or deleted';

CREATE OR REPLACE FUNCTION public.attempt_result_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Results are immutable.' USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS trg_attempt_results_guard ON public.attempt_results;
CREATE TRIGGER trg_attempt_results_guard BEFORE UPDATE OR DELETE ON public.attempt_results
  FOR EACH ROW EXECUTE FUNCTION public.attempt_result_guard();

-- 5. EVENTS (crisis / safety / age stop) for Task 08. One row per attempt and flag.
CREATE TABLE IF NOT EXISTS public.attempt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id),
  kind text NOT NULL CHECK (kind IN ('crisis', 'safety', 'age_stop')),
  flag_key text NOT NULL,
  notify jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (attempt_id, flag_key)
);
CREATE INDEX IF NOT EXISTS idx_attempt_events_open ON public.attempt_events (created_at) WHERE handled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_attempt_events_handled_by ON public.attempt_events (handled_by);

-- 6. ROW LEVEL SECURITY: clients read their own; staff read all; no client writes.
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attempts_select ON public.attempts;
CREATE POLICY attempts_select ON public.attempts FOR SELECT TO authenticated USING (
  public.is_active_staff()
  OR EXISTS (SELECT 1 FROM public.clients c WHERE c.id = attempts.client_id AND c.auth_user_id = (SELECT auth.uid()))
);

DROP POLICY IF EXISTS attempt_answers_select ON public.attempt_answers;
CREATE POLICY attempt_answers_select ON public.attempt_answers FOR SELECT TO authenticated USING (
  public.is_active_staff()
  OR EXISTS (
    SELECT 1 FROM public.attempts a JOIN public.clients c ON c.id = a.client_id
    WHERE a.id = attempt_answers.attempt_id AND c.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS attempt_results_select ON public.attempt_results;
CREATE POLICY attempt_results_select ON public.attempt_results FOR SELECT TO authenticated USING (
  public.is_active_staff()
  OR EXISTS (
    SELECT 1 FROM public.attempts a JOIN public.clients c ON c.id = a.client_id
    WHERE a.id = attempt_results.attempt_id AND c.auth_user_id = (SELECT auth.uid())
  )
);

DROP POLICY IF EXISTS attempt_events_select ON public.attempt_events;
CREATE POLICY attempt_events_select ON public.attempt_events FOR SELECT TO authenticated USING (public.is_active_staff());

-- 7. PRIVILEGES: only the server (service role) issues report IDs.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.next_report_id(text) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.next_report_id(text) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.next_report_id(text) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.next_report_id(text) TO service_role;
  END IF;
  REVOKE ALL ON FUNCTION public.attempt_guard() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.attempt_answer_guard() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.attempt_result_guard() FROM PUBLIC;
END;
$$;

COMMIT;

-- Checks (read-only). Expect 5 tables with RLS on, and next_report_id executable by service_role only.
select relname, relrowsecurity from pg_class where relname in ('attempts','attempt_answers','attempt_results','attempt_events','report_counters') order by relname;
select has_function_privilege('authenticated', 'public.next_report_id(text)', 'execute') as authenticated_can_issue_ids;

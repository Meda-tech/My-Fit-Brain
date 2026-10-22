-- ==============================================================================================
-- Task 11, Step 2 — the simple questionnaire system. Additive: creates new tables and functions only.
-- Run after 20261026000000_reset_question_bank.sql. Deletes nothing.
--
--   questionnaires           one row per test (code, names, report ID prefix)
--   questionnaire_versions   numbered versions; status draft → live → retired; definition jsonb (the
--                            imported JSON). Published versions are frozen; one live and one draft per test.
--   attempts                 one paid assessment, pinned to a version; report ID from report_counters
--   attempt_answers          chosen option ids per question
--   attempt_results          the result and the report, written once at submit, never changed
--   attempt_alerts           crisis / home-safety alerts for the team
--   next_report_id()         MFB-IA-2026-00001 (reads questionnaires.report_prefix; report_counters kept)
--   create_paid_attempt()    one payment → one attempt, report number taken in the same transaction
--   publish_questionnaire_version()  retires the live version and makes the draft live, in one transaction
--
-- RLS: staff read everything (answers and results: super admins and counsellors only, can_view_reports()).
-- Clients read questionnaire names and their own attempt rows; never definitions, answers or results.
-- All writes go through the server (service role).
-- ==============================================================================================

BEGIN;

-- 1. QUESTIONNAIRES
CREATE TABLE public.questionnaires (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{1,8}$'),
  name_en text NOT NULL,
  name_hi text,
  report_prefix text NOT NULL UNIQUE CHECK (report_prefix ~ '^[A-Z-]{2,16}$'),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.questionnaires IS 'One row per assessment (test): code, names, report ID prefix';
CREATE TRIGGER trg_questionnaires_updated_at BEFORE UPDATE ON public.questionnaires
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.questionnaires ENABLE ROW LEVEL SECURITY;
CREATE POLICY questionnaires_select ON public.questionnaires FOR SELECT TO authenticated USING (true);

INSERT INTO public.questionnaires (code, name_en, name_hi, report_prefix, sort) VALUES
  ('IA', 'MFB Intimacy Assessment', 'MFB इंटिमेसी असेसमेंट', 'MFB-IA', 1),
  ('MA', 'MFB Mind Assessment', 'MFB माइंड असेसमेंट', 'MFB-MA', 2)
ON CONFLICT (code) DO NOTHING;

-- 2. VERSIONS
CREATE TABLE public.questionnaire_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  questionnaire_code text NOT NULL REFERENCES public.questionnaires(code),
  number integer NOT NULL CHECK (number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'retired')),
  definition jsonb NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (questionnaire_code, number)
);
COMMENT ON TABLE public.questionnaire_versions IS 'Versions of a questionnaire; the definition is the imported JSON';
CREATE UNIQUE INDEX questionnaire_versions_one_live ON public.questionnaire_versions (questionnaire_code) WHERE status = 'live';
CREATE UNIQUE INDEX questionnaire_versions_one_draft ON public.questionnaire_versions (questionnaire_code) WHERE status = 'draft';
CREATE TRIGGER trg_questionnaire_versions_updated_at BEFORE UPDATE ON public.questionnaire_versions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Published versions never change. A draft may change freely; live may only become retired.
CREATE OR REPLACE FUNCTION public.questionnaire_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Published versions are never deleted.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'live' AND NEW.status = 'retired'
     AND NEW.definition = OLD.definition AND NEW.number = OLD.number
     AND NEW.questionnaire_code = OLD.questionnaire_code AND NEW.published_at = OLD.published_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Published versions never change.' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_questionnaire_versions_guard BEFORE UPDATE OR DELETE ON public.questionnaire_versions
  FOR EACH ROW EXECUTE FUNCTION public.questionnaire_version_guard();

ALTER TABLE public.questionnaire_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY questionnaire_versions_select ON public.questionnaire_versions FOR SELECT
  USING (public.is_active_staff());

-- Publish: the draft becomes live and the previous live version retires, in one transaction.
CREATE OR REPLACE FUNCTION public.publish_questionnaire_version(p_version_id uuid, p_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v public.questionnaire_versions;
BEGIN
  SELECT * INTO v FROM public.questionnaire_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found.';
  END IF;
  IF v.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft can be published.';
  END IF;
  UPDATE public.questionnaire_versions SET status = 'retired'
  WHERE questionnaire_code = v.questionnaire_code AND status = 'live';
  UPDATE public.questionnaire_versions
  SET status = 'live', published_by = p_by, published_at = now()
  WHERE id = p_version_id;
END;
$$;

-- 3. REPORT IDS (report_counters is kept from before; only the prefix lookup changes)
CREATE OR REPLACE FUNCTION public.next_report_id(p_code text)
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
  SELECT report_prefix INTO v_prefix FROM public.questionnaires WHERE code = p_code;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown questionnaire %.', p_code;
  END IF;
  INSERT INTO public.report_counters AS c (test_code, year, last_number)
  VALUES (p_code, v_year, 1)
  ON CONFLICT (test_code, year) DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_prefix || '-' || v_year || '-' || lpad(v_number::text, 5, '0');
END;
$$;

-- 4. ATTEMPTS
CREATE TABLE public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES public.clients(id),
  questionnaire_code text NOT NULL REFERENCES public.questionnaires(code),
  version_id uuid NOT NULL REFERENCES public.questionnaire_versions(id),
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid', 'in_progress', 'completed')),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
  payment_ref text NOT NULL UNIQUE,
  paid_at timestamptz NOT NULL,
  consent_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.attempts IS 'One paid assessment, pinned to the version live when it was paid';
CREATE INDEX idx_attempts_client ON public.attempts (client_id, created_at DESC);
CREATE TRIGGER trg_attempts_updated_at BEFORE UPDATE ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.attempt_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assessments are never deleted.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'completed' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.language IS DISTINCT FROM OLD.language OR NEW.consent_at IS DISTINCT FROM OLD.consent_at
       OR NEW.started_at IS DISTINCT FROM OLD.started_at) THEN
    RAISE EXCEPTION 'A completed assessment never changes.' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.report_id <> OLD.report_id OR NEW.client_id <> OLD.client_id
     OR NEW.questionnaire_code <> OLD.questionnaire_code OR NEW.version_id <> OLD.version_id
     OR NEW.payment_ref <> OLD.payment_ref OR NEW.paid_at <> OLD.paid_at THEN
    RAISE EXCEPTION 'The identity of an assessment never changes.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_attempts_guard BEFORE UPDATE OR DELETE ON public.attempts
  FOR EACH ROW EXECUTE FUNCTION public.attempt_guard();

ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY attempts_select ON public.attempts FOR SELECT USING (
  public.is_active_staff()
  OR client_id IN (SELECT c.id FROM public.clients c WHERE c.auth_user_id = auth.uid())
);

-- One payment → one attempt (per-payment lock; the report number only for a new attempt).
CREATE OR REPLACE FUNCTION public.create_paid_attempt(
  p_client_id uuid,
  p_code text,
  p_version_id uuid,
  p_payment_ref text,
  p_paid_at timestamptz,
  p_language text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_attempt public.attempts;
BEGIN
  IF p_payment_ref IS NULL OR length(p_payment_ref) = 0 THEN
    RAISE EXCEPTION 'A paid attempt needs the payment reference.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attempt:' || p_payment_ref, 0));
  SELECT * INTO v_attempt FROM public.attempts WHERE payment_ref = p_payment_ref;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(v_attempt));
  END IF;
  INSERT INTO public.attempts (report_id, client_id, questionnaire_code, version_id, status, language, payment_ref, paid_at)
  VALUES (public.next_report_id(p_code), p_client_id, p_code, p_version_id, 'paid', coalesce(p_language, 'en'), p_payment_ref, p_paid_at)
  RETURNING * INTO v_attempt;
  RETURN jsonb_build_object('created', true, 'attempt', to_jsonb(v_attempt));
END;
$$;

-- 5. ANSWERS
CREATE TABLE public.attempt_answers (
  attempt_id uuid NOT NULL REFERENCES public.attempts(id),
  question_id text NOT NULL,
  option_ids text[] NOT NULL CHECK (cardinality(option_ids) >= 1),
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, question_id)
);
COMMENT ON TABLE public.attempt_answers IS 'Chosen option ids per question; never free text';

CREATE OR REPLACE FUNCTION public.attempt_answer_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.attempts WHERE id = coalesce(NEW.attempt_id, OLD.attempt_id);
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'Answers of a completed assessment never change.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;
CREATE TRIGGER trg_attempt_answers_guard BEFORE INSERT OR UPDATE OR DELETE ON public.attempt_answers
  FOR EACH ROW EXECUTE FUNCTION public.attempt_answer_guard();

ALTER TABLE public.attempt_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY attempt_answers_select ON public.attempt_answers FOR SELECT USING (public.can_view_reports());

-- 6. RESULTS (written once at submit)
CREATE TABLE public.attempt_results (
  attempt_id uuid PRIMARY KEY REFERENCES public.attempts(id),
  result jsonb NOT NULL,
  report jsonb NOT NULL,
  engine_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.attempt_results IS 'The engine result and the stored report (counsellor and PDF read these)';

CREATE OR REPLACE FUNCTION public.attempt_result_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Results are written once and never change.' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER trg_attempt_results_guard BEFORE UPDATE OR DELETE ON public.attempt_results
  FOR EACH ROW EXECUTE FUNCTION public.attempt_result_guard();

ALTER TABLE public.attempt_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY attempt_results_select ON public.attempt_results FOR SELECT USING (public.can_view_reports());

-- 7. ALERTS
CREATE TABLE public.attempt_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id),
  kind text NOT NULL CHECK (kind IN ('crisis', 'home_safety')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  handled_at timestamptz,
  UNIQUE (attempt_id, kind)
);
COMMENT ON TABLE public.attempt_alerts IS 'Crisis and home-safety alerts for the team (one per attempt and kind)';
ALTER TABLE public.attempt_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY attempt_alerts_select ON public.attempt_alerts FOR SELECT USING (public.is_active_staff());

-- 8. PAYMENTS: point back at the new tables.
ALTER TABLE public.payments
  ADD CONSTRAINT payments_test_code_fkey FOREIGN KEY (test_code) REFERENCES public.questionnaires(code),
  ADD CONSTRAINT payments_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.attempts(id);

-- 9. GRANTS: only the server (service role) runs the functions.
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.next_report_id(text)',
    'public.create_paid_attempt(uuid, text, uuid, text, timestamptz, text)',
    'public.publish_questionnaire_version(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
  REVOKE ALL ON FUNCTION public.questionnaire_version_guard() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.attempt_guard() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.attempt_answer_guard() FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.attempt_result_guard() FROM PUBLIC;
END;
$$;

COMMIT;

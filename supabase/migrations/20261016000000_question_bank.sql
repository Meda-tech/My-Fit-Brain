-- ==============================================================================
-- MFB Assessments — Question bank as versioned data (Task 03)
--
-- Every question, option, report sentence and scoring / routing / flag rule of both tests lives in
-- qb_* tables as versioned data. Published versions are frozen forever (freeze trigger, also for the
-- service role). Status changes only through the qb_* workflow functions. Rule conditions use the
-- JSON format in docs/questionbank/rules-reference.md.
--
-- One transaction (BEGIN ... COMMIT): paste the whole file into the Supabase SQL Editor and run.
-- Safe to run once on a database that has 20261015000000_mfb_foundation.sql applied.
-- Checks after running: docs/tasks/03-verify.sql. Loading the banks: docs/tasks/03-load-banks.md.
--
-- ROLLBACK (manual, not automatic). Run in one transaction:
--   DROP FUNCTION IF EXISTS public.qb_import_version(jsonb), public.qb_delete_draft(uuid),
--     public.qb_publish(uuid, text), public.qb_return_to_draft(uuid), public.qb_submit_for_review(uuid),
--     public.qb_start_new_version(text, text), public.qb_validate_version(uuid),
--     public.qb_condition_refs(jsonb), public.qb_assert_can_edit(), public.qb_assert_can_approve();
--   DROP TABLE IF EXISTS public.qb_audit_log, public.qb_test_cases, public.qb_report_rules,
--     public.qb_format_rules, public.qb_flags, public.qb_option_rules, public.qb_visibility_rules,
--     public.qb_overrides, public.qb_point_rules, public.qb_scoring, public.qb_tiers,
--     public.qb_item_texts, public.qb_texts, public.qb_options, public.qb_questions, public.qb_modules,
--     public.qb_versions, public.qb_tests CASCADE;
--   DROP FUNCTION IF EXISTS public.qb_freeze_guard(), public.qb_version_guard(), public.qb_audit(),
--     public.qb_guard_content_permissions(), public.qb_is_trusted_caller(),
--     public.can_edit_content(), public.can_approve_content();
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS can_edit_content,
--     DROP COLUMN IF EXISTS can_approve_content;
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. CONTENT PERMISSIONS ON STAFF PROFILES
-- ------------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS can_edit_content boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_approve_content boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.can_edit_content IS 'May import, copy, edit and submit question bank drafts';
COMMENT ON COLUMN public.profiles.can_approve_content IS 'May publish question bank versions';

UPDATE public.profiles
SET can_edit_content = true, can_approve_content = true
WHERE role = 'super_admin' AND is_active = true;

-- Direct SQL (SQL Editor, migrations, scripts with the DB password) and the service role are trusted.
-- API calls always carry JWT claims; a direct connection has none.
CREATE OR REPLACE FUNCTION public.qb_is_trusted_caller()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
      OR (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.can_edit_content()
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
      AND can_edit_content = true
  );
$$;

CREATE OR REPLACE FUNCTION public.can_approve_content()
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
      AND can_approve_content = true
  );
$$;

-- Staff may update their own profile row (Phase 1 policy); they must not grant themselves content rights.
CREATE OR REPLACE FUNCTION public.qb_guard_content_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.qb_is_trusted_caller() OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.can_edit_content OR NEW.can_approve_content THEN
      RAISE EXCEPTION 'Only a super admin can grant question bank permissions.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.can_edit_content IS DISTINCT FROM OLD.can_edit_content
     OR NEW.can_approve_content IS DISTINCT FROM OLD.can_approve_content THEN
    RAISE EXCEPTION 'Only a super admin can change question bank permissions.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_content_permissions ON public.profiles;
CREATE TRIGGER trg_profiles_content_permissions
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.qb_guard_content_permissions();

-- ------------------------------------------------------------------------------
-- 2. VERSIONS
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.qb_tests (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2,4}$'),
  name_en text NOT NULL,
  name_hi text,
  report_id_prefix text NOT NULL UNIQUE,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.qb_tests IS 'Assessment products (IA, MA). Hindi product names are pending (NULL).';

INSERT INTO public.qb_tests (code, name_en, name_hi, report_id_prefix, sort) VALUES
  ('IA', 'MFB Intimacy Assessment', NULL, 'MFB-IA', 1),
  ('MA', 'MFB Mind Assessment', NULL, 'MFB-MA', 2)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.qb_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_code text NOT NULL REFERENCES public.qb_tests(code),
  version_label text NOT NULL CHECK (version_label ~ '^[0-9]+(\.[0-9]+)*$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'live', 'retired')),
  based_on_version_id uuid REFERENCES public.qb_versions(id),
  change_note text,
  source_file_name text,
  source_checksum text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_at timestamptz,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_code, version_label)
);
COMMENT ON TABLE public.qb_versions IS 'Question bank versions. draft -> in_review -> live -> retired; live and retired are frozen.';

CREATE UNIQUE INDEX IF NOT EXISTS qb_versions_one_live
  ON public.qb_versions (test_code) WHERE status = 'live';
CREATE UNIQUE INDEX IF NOT EXISTS qb_versions_one_open
  ON public.qb_versions (test_code) WHERE status IN ('draft', 'in_review');
CREATE INDEX IF NOT EXISTS idx_qb_versions_based_on ON public.qb_versions (based_on_version_id);
CREATE INDEX IF NOT EXISTS idx_qb_versions_created_by ON public.qb_versions (created_by);
CREATE INDEX IF NOT EXISTS idx_qb_versions_submitted_by ON public.qb_versions (submitted_by);
CREATE INDEX IF NOT EXISTS idx_qb_versions_approved_by ON public.qb_versions (approved_by);

-- ------------------------------------------------------------------------------
-- 3. CONTENT
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.qb_modules (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_en text NOT NULL,
  name_hi text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('intake', 'gate', 'core', 'solo_core', 'couple', 'individual', 'dose', 'flag')),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, code)
);

CREATE TABLE IF NOT EXISTS public.qb_questions (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  qid text NOT NULL,
  module_code text NOT NULL,
  type text NOT NULL CHECK (type IN ('likert', 'yn', 'single', 'multi')),
  text_en text NOT NULL,
  text_hi text NOT NULL,
  reverse boolean NOT NULL DEFAULT false,
  scored text NOT NULL CHECK (scored IN ('yes', 'no', 'points')),
  path text NOT NULL DEFAULT 'all' CHECK (path IN ('all', 'partner', 'solo')),
  sort integer NOT NULL DEFAULT 0,
  is_protected boolean NOT NULL DEFAULT false,
  source_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, qid),
  FOREIGN KEY (version_id, module_code) REFERENCES public.qb_modules(version_id, code) ON UPDATE CASCADE
);
COMMENT ON COLUMN public.qb_questions.source_note IS 'Excel "Routing / Dev note", kept for reference only. Rules live in the qb_* rule tables.';

CREATE TABLE IF NOT EXISTS public.qb_options (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  qid text NOT NULL,
  option_code text NOT NULL CHECK (option_code ~ '^[A-Za-z0-9_]+$'),
  label_en text NOT NULL,
  label_hi text NOT NULL,
  value integer,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, qid, option_code),
  FOREIGN KEY (version_id, qid) REFERENCES public.qb_questions(version_id, qid) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS public.qb_texts (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  module_code text,
  band text CHECK (band IN ('Low', 'Mild', 'Moderate', 'High')),
  text_en text NOT NULL,
  text_hi text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, key),
  FOREIGN KEY (version_id, module_code) REFERENCES public.qb_modules(version_id, code) ON UPDATE CASCADE
);
COMMENT ON TABLE public.qb_texts IS 'Report Text rows plus Flags & Safety texts (key = flag name).';

CREATE TABLE IF NOT EXISTS public.qb_item_texts (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  qid text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('strength', 'stuck')),
  trigger text NOT NULL CHECK (trigger IN ('often', 'often_or_sometimes', 'often_sometimes_or_yes')),
  text_en text NOT NULL,
  text_hi text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, qid, kind),
  FOREIGN KEY (version_id, qid) REFERENCES public.qb_questions(version_id, qid) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS public.qb_tiers (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  sessions integer NOT NULL CHECK (sessions > 0),
  plan_en text NOT NULL,
  plan_hi text NOT NULL,
  pace_en text NOT NULL,
  pace_hi text NOT NULL,
  typical_case text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, sessions)
);

-- ------------------------------------------------------------------------------
-- 4. RULES (conditions: docs/questionbank/rules-reference.md)
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.qb_scoring (
  version_id uuid PRIMARY KEY REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  scale jsonb NOT NULL,
  bands jsonb NOT NULL,
  rounding text NOT NULL DEFAULT 'half_up' CHECK (rounding IN ('half_up')),
  core_module jsonb NOT NULL,
  gate jsonb NOT NULL,
  "primary" jsonb NOT NULL,
  tier_thresholds jsonb NOT NULL,
  pace jsonb NOT NULL,
  progress jsonb NOT NULL,
  registration jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.qb_point_rules (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  source text NOT NULL CHECK (source IN ('primary_band_severity', 'answer_value', 'fixed')),
  qid text,
  points integer,
  condition jsonb,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, key)
);

CREATE TABLE IF NOT EXISTS public.qb_overrides (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  condition jsonb NOT NULL,
  action text NOT NULL CHECK (action IN ('cap', 'floor')),
  sessions integer NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, key)
);

CREATE TABLE IF NOT EXISTS public.qb_visibility_rules (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  qid text NOT NULL,
  condition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, qid),
  FOREIGN KEY (version_id, qid) REFERENCES public.qb_questions(version_id, qid) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS public.qb_option_rules (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  qid text NOT NULL,
  option_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('hide', 'order_first')),
  condition jsonb NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, qid, option_code, kind),
  FOREIGN KEY (version_id, qid, option_code) REFERENCES public.qb_options(version_id, qid, option_code) ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS public.qb_flags (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  condition jsonb NOT NULL,
  effects jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_protected boolean NOT NULL DEFAULT false,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, key)
);

CREATE TABLE IF NOT EXISTS public.qb_format_rules (
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  key text NOT NULL,
  condition jsonb NOT NULL,
  format text NOT NULL CHECK (format IN ('individual', 'couple', 'mixed', 'individual_partner_joins')),
  split jsonb,
  add_text_key text,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, key)
);
COMMENT ON TABLE public.qb_format_rules IS 'Session format; rules are checked in sort order and the first match wins.';

CREATE TABLE IF NOT EXISTS public.qb_report_rules (
  version_id uuid PRIMARY KEY REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  strengths jsonb NOT NULL,
  stuck jsonb NOT NULL,
  focus jsonb NOT NULL,
  tone jsonb NOT NULL,
  interpretation jsonb NOT NULL,
  layouts jsonb NOT NULL,
  format_texts jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_language jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------------------
-- 5. TEST CASES AND AUDIT LOG
-- ------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.qb_test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.qb_versions(id) ON DELETE CASCADE,
  name text NOT NULL,
  source text NOT NULL CHECK (source IN ('worked_example', 'manual')),
  context jsonb NOT NULL,
  answers jsonb NOT NULL,
  expected jsonb NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, name)
);

-- No foreign key on version_id: entries outlive deleted drafts.
CREATE TABLE IF NOT EXISTS public.qb_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version_id uuid,
  table_name text NOT NULL,
  row_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old jsonb,
  new jsonb,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_qb_audit_log_version ON public.qb_audit_log (version_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_qb_audit_log_changed_by ON public.qb_audit_log (changed_by);

-- ------------------------------------------------------------------------------
-- 6. TRIGGERS: updated_at, freeze, version guard, audit
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'qb_tests', 'qb_versions', 'qb_modules', 'qb_questions', 'qb_options', 'qb_texts', 'qb_item_texts',
    'qb_tiers', 'qb_scoring', 'qb_point_rules', 'qb_overrides', 'qb_visibility_rules', 'qb_option_rules',
    'qb_flags', 'qb_format_rules', 'qb_report_rules', 'qb_test_cases'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()',
      t
    );
  END LOOP;
END;
$$;

-- Content, rule and test-case rows may change only while their version is a draft. Applies to
-- everyone, including the service role (triggers are not bypassed by RLS bypass).
CREATE OR REPLACE FUNCTION public.qb_freeze_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_status FROM public.qb_versions WHERE id = OLD.version_id;
    -- No version row: the cascade from deleting a draft (only drafts can be deleted).
    IF v_status IS NOT NULL AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'Version % is % and cannot be changed. Start a new version to make changes.',
        OLD.version_id, v_status USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_status FROM public.qb_versions WHERE id = NEW.version_id;
    IF v_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Version % is % and cannot be changed. Start a new version to make changes.',
        NEW.version_id, coalesce(v_status, 'missing') USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

-- qb_versions: status changes only inside the workflow functions; non-draft versions are frozen.
CREATE OR REPLACE FUNCTION public.qb_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(current_setting('qb.workflow', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'New versions start as draft.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Version status changes only through qb_submit_for_review, qb_return_to_draft and qb_publish.'
        USING ERRCODE = '42501';
    END IF;
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Version % is % and cannot be changed.', OLD.id, OLD.status USING ERRCODE = '42501';
    END IF;
    IF NEW.test_code IS DISTINCT FROM OLD.test_code
       OR NEW.based_on_version_id IS DISTINCT FROM OLD.based_on_version_id
       OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
      RAISE EXCEPTION 'Workflow columns change only through the qb_* workflow functions.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft versions can be deleted.' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_qb_versions_guard ON public.qb_versions;
CREATE TRIGGER trg_qb_versions_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.qb_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.qb_version_guard();

-- Generic audit trigger. Trigger arguments name the columns that identify the row.
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
  IF TG_OP = 'UPDATE' AND to_jsonb(OLD) - 'updated_at' = to_jsonb(NEW) - 'updated_at' THEN
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
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('qb_modules', 'code'),
      ('qb_questions', 'qid'),
      ('qb_options', 'qid, option_code'),
      ('qb_texts', 'key'),
      ('qb_item_texts', 'qid, kind'),
      ('qb_tiers', 'sessions'),
      ('qb_scoring', NULL),
      ('qb_point_rules', 'key'),
      ('qb_overrides', 'key'),
      ('qb_visibility_rules', 'qid'),
      ('qb_option_rules', 'qid, option_code, kind'),
      ('qb_flags', 'key'),
      ('qb_format_rules', 'key'),
      ('qb_report_rules', NULL),
      ('qb_test_cases', 'id, name')
    ) AS t(tbl, key_cols)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_freeze ON public.%1$I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_freeze BEFORE INSERT OR UPDATE OR DELETE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.qb_freeze_guard()',
      r.tbl
    );
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_audit ON public.%1$I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_audit AFTER INSERT OR UPDATE OR DELETE ON public.%1$I '
      'FOR EACH ROW EXECUTE FUNCTION public.qb_audit(%2$s)',
      r.tbl,
      coalesce(
        (SELECT string_agg(quote_literal(trim(c)), ', ') FROM unnest(string_to_array(r.key_cols, ',')) AS c),
        ''
      )
    );
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS trg_qb_versions_audit ON public.qb_versions;
CREATE TRIGGER trg_qb_versions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.qb_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.qb_audit('id', 'version_label', 'status');

-- ------------------------------------------------------------------------------
-- 7. VALIDATION
-- ------------------------------------------------------------------------------

-- Every reference inside a condition: (kind, ref1, ref2).
-- kind: question (ref1 = qid) · option (qid, option_code) · module · flag · age_band · sex · unknown_fact
CREATE OR REPLACE FUNCTION public.qb_condition_refs(c jsonb)
RETURNS TABLE (kind text, ref1 text, ref2 text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  child jsonb;
  v text;
  f text;
BEGIN
  IF c IS NULL OR jsonb_typeof(c) <> 'object' THEN
    RETURN;
  END IF;
  IF c ? 'all' OR c ? 'any' THEN
    FOR child IN SELECT jsonb_array_elements(coalesce(c -> 'all', c -> 'any')) LOOP
      RETURN QUERY SELECT * FROM public.qb_condition_refs(child);
    END LOOP;
    RETURN;
  END IF;
  IF c ? 'not' THEN
    RETURN QUERY SELECT * FROM public.qb_condition_refs(c -> 'not');
    RETURN;
  END IF;

  f := c ->> 'fact';
  IF f IN ('answer', 'answered_any_except', 'answer_value') THEN
    kind := 'question'; ref1 := c ->> 'q'; ref2 := NULL;
    RETURN NEXT;
    IF f <> 'answer_value' THEN
      FOR v IN
        SELECT CASE WHEN jsonb_typeof(c -> 'value') = 'array' THEN e ELSE c ->> 'value' END
        FROM (
          SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c -> 'value') = 'array' THEN c -> 'value' ELSE '[null]'::jsonb END) AS e
        ) AS vals
      LOOP
        kind := 'option'; ref1 := c ->> 'q'; ref2 := v;
        RETURN NEXT;
      END LOOP;
    END IF;
  ELSIF f = 'module_chosen' THEN
    kind := 'module'; ref1 := c ->> 'value'; ref2 := NULL;
    RETURN NEXT;
  ELSIF f = 'band' THEN
    IF NOT ((c ->> 'module') = ANY (ARRAY['primary', 'second', 'core'])) THEN
      kind := 'module'; ref1 := c ->> 'module'; ref2 := NULL;
      RETURN NEXT;
    END IF;
  ELSIF f = 'flag' THEN
    kind := 'flag'; ref1 := c ->> 'key'; ref2 := NULL;
    RETURN NEXT;
  ELSIF f IN ('age_band', 'sex') THEN
    FOR v IN
      SELECT CASE WHEN jsonb_typeof(c -> 'value') = 'array' THEN e ELSE c ->> 'value' END
      FROM (
        SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(c -> 'value') = 'array' THEN c -> 'value' ELSE '[null]'::jsonb END) AS e
      ) AS vals
    LOOP
      kind := f; ref1 := v; ref2 := NULL;
      RETURN NEXT;
    END LOOP;
  ELSIF f IN ('age', 'path', 'chosen_count', 'chosen_kinds', 'all_bands', 'count_bands') THEN
    RETURN;
  ELSE
    kind := 'unknown_fact'; ref1 := coalesce(f, c::text); ref2 := NULL;
    RETURN NEXT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.qb_validate_version(p_version_id uuid)
RETURNS TABLE (severity text, code text, message text, ref text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_based_on uuid;
  v_age_qid text;
  v_sex_qid text;
BEGIN
  IF NOT (public.qb_is_trusted_caller() OR public.is_active_staff()) THEN
    RAISE EXCEPTION 'Only staff can validate question bank versions.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qb_versions WHERE id = p_version_id) THEN
    RAISE EXCEPTION 'Version % not found.', p_version_id;
  END IF;

  SELECT based_on_version_id INTO v_based_on FROM public.qb_versions WHERE id = p_version_id;
  SELECT registration ->> 'age_band_qid', registration ->> 'sex_qid' INTO v_age_qid, v_sex_qid
  FROM public.qb_scoring WHERE version_id = p_version_id;

  -- Required single rows.
  IF NOT EXISTS (SELECT 1 FROM public.qb_scoring WHERE version_id = p_version_id) THEN
    RETURN QUERY SELECT 'error', 'missing_scoring', 'The version has no scoring rules (qb_scoring).', NULL::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.qb_report_rules WHERE version_id = p_version_id) THEN
    RETURN QUERY SELECT 'error', 'missing_report_rules', 'The version has no report rules (qb_report_rules).', NULL::text;
  END IF;

  -- Missing Hindi.
  RETURN QUERY
    SELECT 'error', 'missing_hindi', format('Module %s has no Hindi name.', m.code), m.code
    FROM public.qb_modules m WHERE m.version_id = p_version_id AND btrim(m.name_hi) = ''
    UNION ALL
    SELECT 'error', 'missing_hindi', format('%s has no Hindi text.', q.qid), q.qid
    FROM public.qb_questions q WHERE q.version_id = p_version_id AND btrim(q.text_hi) = ''
    UNION ALL
    SELECT 'error', 'missing_hindi', format('%s option %s has no Hindi label.', o.qid, o.option_code), o.qid
    FROM public.qb_options o WHERE o.version_id = p_version_id AND btrim(o.label_hi) = ''
    UNION ALL
    SELECT 'error', 'missing_hindi', format('Text %s has no Hindi.', t.key), t.key
    FROM public.qb_texts t WHERE t.version_id = p_version_id AND btrim(t.text_hi) = ''
    UNION ALL
    SELECT 'error', 'missing_hindi', format('%s text for %s has no Hindi.', i.kind, i.qid), i.qid
    FROM public.qb_item_texts i WHERE i.version_id = p_version_id AND btrim(i.text_hi) = ''
    UNION ALL
    SELECT 'error', 'missing_hindi', format('Tier %s has no Hindi plan or pace.', r.sessions), r.sessions::text
    FROM public.qb_tiers r WHERE r.version_id = p_version_id AND (btrim(r.plan_hi) = '' OR btrim(r.pace_hi) = '');

  -- Option shapes.
  RETURN QUERY
    SELECT 'error', 'likert_options', format('%s (likert) must have exactly 4 options valued 0–3.', q.qid), q.qid
    FROM public.qb_questions q
    WHERE q.version_id = p_version_id AND q.type = 'likert'
      AND coalesce((
        SELECT array_agg(o.value ORDER BY o.value) FROM public.qb_options o
        WHERE o.version_id = q.version_id AND o.qid = q.qid
      ), '{}') IS DISTINCT FROM ARRAY[0, 1, 2, 3]
    UNION ALL
    SELECT 'error', 'yn_options', format('%s (yn) must have options no = 0 and yes = 3.', q.qid), q.qid
    FROM public.qb_questions q
    WHERE q.version_id = p_version_id AND q.type = 'yn'
      AND (
        (SELECT count(*) FROM public.qb_options o WHERE o.version_id = q.version_id AND o.qid = q.qid) <> 2
        OR NOT EXISTS (SELECT 1 FROM public.qb_options o WHERE o.version_id = q.version_id AND o.qid = q.qid AND o.option_code = 'no' AND o.value = 0)
        OR NOT EXISTS (SELECT 1 FROM public.qb_options o WHERE o.version_id = q.version_id AND o.qid = q.qid AND o.option_code = 'yes' AND o.value = 3)
      )
    UNION ALL
    SELECT 'error', 'no_options', format('%s has no options.', q.qid), q.qid
    FROM public.qb_questions q
    WHERE q.version_id = p_version_id
      AND NOT EXISTS (SELECT 1 FROM public.qb_options o WHERE o.version_id = q.version_id AND o.qid = q.qid);

  -- Module codes: duplicates ignoring case (the primary key catches exact duplicates).
  RETURN QUERY
    SELECT 'error', 'duplicate_module', format('Module code %s is used more than once.', upper(m.code)), upper(m.code)
    FROM public.qb_modules m WHERE m.version_id = p_version_id
    GROUP BY upper(m.code) HAVING count(*) > 1;

  -- References inside rule conditions.
  RETURN QUERY
    WITH conds (src, cond) AS (
      SELECT 'Core module rule', r -> 'when'
      FROM public.qb_scoring s, jsonb_array_elements(s.core_module -> 'rules') r WHERE s.version_id = p_version_id
      UNION ALL SELECT 'Point rule ' || p.key, p.condition FROM public.qb_point_rules p WHERE p.version_id = p_version_id
      UNION ALL SELECT 'Override ' || o.key, o.condition FROM public.qb_overrides o WHERE o.version_id = p_version_id
      UNION ALL SELECT 'Visibility rule ' || v.qid, v.condition FROM public.qb_visibility_rules v WHERE v.version_id = p_version_id
      UNION ALL SELECT 'Option rule ' || o.qid || '.' || o.option_code, o.condition FROM public.qb_option_rules o WHERE o.version_id = p_version_id
      UNION ALL SELECT 'Flag ' || f.key, f.condition FROM public.qb_flags f WHERE f.version_id = p_version_id
      UNION ALL SELECT 'Format rule ' || f.key, f.condition FROM public.qb_format_rules f WHERE f.version_id = p_version_id
      UNION ALL SELECT 'Tone', r.tone -> 'condition' FROM public.qb_report_rules r WHERE r.version_id = p_version_id
    ),
    refs AS (
      SELECT c.src, x.kind, x.ref1, x.ref2 FROM conds c CROSS JOIN LATERAL public.qb_condition_refs(c.cond) x
    )
    SELECT 'error', 'unknown_qid', format('%s refers to unknown question %s.', r.src, r.ref1), r.ref1
    FROM refs r WHERE r.kind = 'question'
      AND NOT EXISTS (SELECT 1 FROM public.qb_questions q WHERE q.version_id = p_version_id AND q.qid = r.ref1)
    UNION ALL
    SELECT 'error', 'unknown_option', format('%s refers to unknown option %s.%s.', r.src, r.ref1, r.ref2), r.ref1
    FROM refs r WHERE r.kind = 'option'
      AND EXISTS (SELECT 1 FROM public.qb_questions q WHERE q.version_id = p_version_id AND q.qid = r.ref1)
      AND NOT EXISTS (SELECT 1 FROM public.qb_options o WHERE o.version_id = p_version_id AND o.qid = r.ref1 AND o.option_code = r.ref2)
    UNION ALL
    SELECT 'error', 'unknown_module', format('%s refers to unknown module %s.', r.src, r.ref1), r.ref1
    FROM refs r WHERE r.kind = 'module'
      AND NOT EXISTS (SELECT 1 FROM public.qb_modules m WHERE m.version_id = p_version_id AND m.code = r.ref1)
    UNION ALL
    SELECT 'error', 'unknown_flag', format('%s refers to unknown flag %s.', r.src, r.ref1), r.ref1
    FROM refs r WHERE r.kind = 'flag'
      AND NOT EXISTS (SELECT 1 FROM public.qb_flags f WHERE f.version_id = p_version_id AND f.key = r.ref1)
    UNION ALL
    SELECT 'error', 'unknown_option', format('%s uses %s, which is not an option of %s.', r.src, r.ref1, coalesce(v_age_qid, '(age question)')), r.ref1
    FROM refs r WHERE r.kind = 'age_band'
      AND NOT EXISTS (SELECT 1 FROM public.qb_options o WHERE o.version_id = p_version_id AND o.qid = v_age_qid AND o.option_code = r.ref1)
    UNION ALL
    SELECT 'error', 'unknown_option', format('%s uses %s, which is not an option of %s.', r.src, r.ref1, coalesce(v_sex_qid, '(sex question)')), r.ref1
    FROM refs r WHERE r.kind = 'sex'
      AND NOT EXISTS (SELECT 1 FROM public.qb_options o WHERE o.version_id = p_version_id AND o.qid = v_sex_qid AND o.option_code = r.ref1)
    UNION ALL
    SELECT 'error', 'unknown_fact', format('%s uses an unknown condition fact (%s).', r.src, r.ref1), NULL
    FROM refs r WHERE r.kind = 'unknown_fact';

  -- Other references: questions, modules and text keys named outside conditions.
  RETURN QUERY
    WITH qrefs (src, qid) AS (
      SELECT 'Point rule ' || p.key, p.qid FROM public.qb_point_rules p WHERE p.version_id = p_version_id AND p.qid IS NOT NULL
      UNION ALL SELECT 'Gate', s.gate ->> 'qid' FROM public.qb_scoring s WHERE s.version_id = p_version_id
      UNION ALL SELECT 'Registration', s.registration ->> 'age_band_qid' FROM public.qb_scoring s WHERE s.version_id = p_version_id
      UNION ALL SELECT 'Registration', s.registration ->> 'sex_qid' FROM public.qb_scoring s WHERE s.version_id = p_version_id
      UNION ALL SELECT 'Progress', x FROM public.qb_scoring s, jsonb_array_elements_text(s.progress -> 'items' -> 'qids') x WHERE s.version_id = p_version_id
      UNION ALL SELECT 'Progress', x FROM public.qb_scoring s, jsonb_array_elements_text(s.progress -> 'reuse_qids') x WHERE s.version_id = p_version_id
      UNION ALL SELECT 'Strengths priority', x FROM public.qb_report_rules r, jsonb_array_elements_text(r.strengths -> 'priority') x WHERE r.version_id = p_version_id
      UNION ALL SELECT 'Report language', r.report_language ->> 'qid' FROM public.qb_report_rules r WHERE r.version_id = p_version_id
    )
    SELECT 'error', 'unknown_qid', format('%s refers to unknown question %s.', q.src, q.qid), q.qid
    FROM qrefs q
    WHERE NOT EXISTS (SELECT 1 FROM public.qb_questions x WHERE x.version_id = p_version_id AND x.qid = q.qid);

  RETURN QUERY
    WITH mrefs (src, module) AS (
      SELECT 'Core module rule', r ->> 'module'
      FROM public.qb_scoring s, jsonb_array_elements(s.core_module -> 'rules') r WHERE s.version_id = p_version_id
      UNION ALL SELECT 'Core module default', s.core_module -> 'default' ->> 'module' FROM public.qb_scoring s WHERE s.version_id = p_version_id
    )
    SELECT 'error', 'unknown_module', format('%s refers to unknown module %s.', m.src, m.module), m.module
    FROM mrefs m
    WHERE NOT EXISTS (SELECT 1 FROM public.qb_modules x WHERE x.version_id = p_version_id AND x.code = m.module);

  RETURN QUERY
    WITH trefs (src, key) AS (
      SELECT 'Flag ' || f.key, f.effects ->> 'report_block' FROM public.qb_flags f WHERE f.version_id = p_version_id AND f.effects ? 'report_block'
      UNION ALL SELECT 'Flag ' || f.key, f.key FROM public.qb_flags f
        WHERE f.version_id = p_version_id AND (f.effects ? 'stop' OR f.effects ? 'interrupt')
      UNION ALL SELECT 'Format rule ' || f.key, f.add_text_key FROM public.qb_format_rules f WHERE f.version_id = p_version_id AND f.add_text_key IS NOT NULL
      UNION ALL SELECT 'Tone', r.tone ->> 'ready_key' FROM public.qb_report_rules r WHERE r.version_id = p_version_id
      UNION ALL SELECT 'Tone', r.tone ->> 'gentle_key' FROM public.qb_report_rules r WHERE r.version_id = p_version_id
      UNION ALL SELECT 'Crisis layout', r.layouts -> 'crisis' ->> 'top_block' FROM public.qb_report_rules r WHERE r.version_id = p_version_id
      UNION ALL SELECT 'Crisis layout', r.layouts -> 'crisis' ->> 'next_key' FROM public.qb_report_rules r WHERE r.version_id = p_version_id
      UNION ALL SELECT 'Crisis layout', x FROM public.qb_report_rules r, jsonb_array_elements_text(r.layouts -> 'crisis' -> 'hide') x WHERE r.version_id = p_version_id
      UNION ALL SELECT 'Format texts', x.value FROM public.qb_report_rules r, jsonb_each_text(r.format_texts) x WHERE r.version_id = p_version_id
      UNION ALL SELECT 'Progress', x.value FROM public.qb_scoring s, jsonb_each_text(s.progress -> 'texts') x WHERE s.version_id = p_version_id
    )
    SELECT 'error', 'unknown_text', format('%s refers to unknown text key %s.', t.src, t.key), t.key
    FROM trefs t
    WHERE NOT EXISTS (SELECT 1 FROM public.qb_texts x WHERE x.version_id = p_version_id AND x.key = t.key);

  RETURN QUERY
    SELECT 'error', 'missing_strength_text', format('Strengths priority lists %s, which has no STRENGTH text.', x), x
    FROM public.qb_report_rules r, jsonb_array_elements_text(r.strengths -> 'priority') x
    WHERE r.version_id = p_version_id
      AND EXISTS (SELECT 1 FROM public.qb_questions q WHERE q.version_id = p_version_id AND q.qid = x)
      AND NOT EXISTS (SELECT 1 FROM public.qb_item_texts i WHERE i.version_id = p_version_id AND i.qid = x AND i.kind = 'strength');

  RETURN QUERY
    SELECT 'error', 'unknown_tier', format('Tier threshold uses %s sessions but there is no such tier.', t ->> 'sessions'), t ->> 'sessions'
    FROM public.qb_scoring s, jsonb_array_elements(s.tier_thresholds) t
    WHERE s.version_id = p_version_id
      AND NOT EXISTS (SELECT 1 FROM public.qb_tiers x WHERE x.version_id = p_version_id AND x.sessions = (t ->> 'sessions')::int);

  -- Protected flags: the safety flags must exist and stay protected.
  RETURN QUERY
    SELECT 'error', 'protected_missing', format('Protected flag %s is missing.', k), k
    FROM unnest(ARRAY['AGE_STOP', 'CRISIS', 'SAFETY']) k
    WHERE NOT EXISTS (SELECT 1 FROM public.qb_flags f WHERE f.version_id = p_version_id AND f.key = k)
    UNION ALL
    SELECT 'error', 'protected_changed', format('Flag %s must stay protected.', f.key), f.key
    FROM public.qb_flags f
    WHERE f.version_id = p_version_id AND f.key = ANY (ARRAY['AGE_STOP', 'CRISIS', 'SAFETY']) AND NOT f.is_protected;

  -- Protected questions and flags of the version this one is based on: present and unchanged.
  IF v_based_on IS NOT NULL THEN
    RETURN QUERY
      SELECT 'error', 'protected_missing', format('Protected question %s is missing.', old.qid), old.qid
      FROM public.qb_questions old
      WHERE old.version_id = v_based_on AND old.is_protected
        AND NOT EXISTS (SELECT 1 FROM public.qb_questions q WHERE q.version_id = p_version_id AND q.qid = old.qid)
      UNION ALL
      SELECT 'error', 'protected_changed', format('Protected question %s changed structure.', old.qid), old.qid
      FROM public.qb_questions old
      JOIN public.qb_questions q ON q.version_id = p_version_id AND q.qid = old.qid
      WHERE old.version_id = v_based_on AND old.is_protected
        AND (
          NOT q.is_protected OR q.type <> old.type OR q.module_code <> old.module_code
          OR (SELECT jsonb_agg(jsonb_build_array(o.option_code, o.value, o.sort) ORDER BY o.sort, o.option_code)
              FROM public.qb_options o WHERE o.version_id = p_version_id AND o.qid = q.qid)
             IS DISTINCT FROM
             (SELECT jsonb_agg(jsonb_build_array(o.option_code, o.value, o.sort) ORDER BY o.sort, o.option_code)
              FROM public.qb_options o WHERE o.version_id = v_based_on AND o.qid = old.qid)
        )
      UNION ALL
      SELECT 'error', 'protected_missing', format('Protected flag %s is missing.', old.key), old.key
      FROM public.qb_flags old
      WHERE old.version_id = v_based_on AND old.is_protected
        AND old.key <> ALL (ARRAY['AGE_STOP', 'CRISIS', 'SAFETY'])
        AND NOT EXISTS (SELECT 1 FROM public.qb_flags f WHERE f.version_id = p_version_id AND f.key = old.key)
      UNION ALL
      SELECT 'error', 'protected_changed', format('Protected flag %s changed.', old.key), old.key
      FROM public.qb_flags old
      JOIN public.qb_flags f ON f.version_id = p_version_id AND f.key = old.key
      WHERE old.version_id = v_based_on AND old.is_protected
        AND (f.condition IS DISTINCT FROM old.condition OR f.effects IS DISTINCT FROM old.effects OR NOT f.is_protected);
  END IF;

  -- Test cases refer to real questions (warning: they are verified separately).
  RETURN QUERY
    SELECT 'warning', 'test_case_qid', format('Test case "%s" answers unknown question %s.', t.name, a.key), a.key
    FROM public.qb_test_cases t, jsonb_each(t.answers) a
    WHERE t.version_id = p_version_id
      AND NOT EXISTS (SELECT 1 FROM public.qb_questions q WHERE q.version_id = p_version_id AND q.qid = a.key);
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. WORKFLOW FUNCTIONS (the only way to change a version's status)
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.qb_assert_can_edit()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.qb_is_trusted_caller() OR public.can_edit_content()) THEN
    RAISE EXCEPTION 'You do not have permission to edit question bank content.' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.qb_assert_can_approve()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.qb_is_trusted_caller() OR public.can_approve_content()) THEN
    RAISE EXCEPTION 'You do not have permission to publish question bank versions.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Raises if the version has validation errors; lists the first ten.
CREATE OR REPLACE FUNCTION public.qb_raise_if_invalid(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_list text;
BEGIN
  SELECT count(*), string_agg(x.message, E'\n')
  INTO v_count, v_list
  FROM (
    SELECT v.message FROM public.qb_validate_version(p_version_id) v
    WHERE v.severity = 'error' ORDER BY v.code, v.ref LIMIT 10
  ) x;
  IF v_count > 0 THEN
    SELECT count(*) INTO v_count FROM public.qb_validate_version(p_version_id) v WHERE v.severity = 'error';
    RAISE EXCEPTION 'The version has % validation error(s):%', v_count, E'\n' || v_list USING ERRCODE = '23514';
  END IF;
END;
$$;

-- Copies every content, rule and test-case row from one version to another (a new draft).
CREATE OR REPLACE FUNCTION public.qb_copy_version_rows(p_from uuid, p_to uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.qb_modules (version_id, code, name_en, name_hi, kind, sort)
  SELECT p_to, code, name_en, name_hi, kind, sort FROM public.qb_modules WHERE version_id = p_from;

  INSERT INTO public.qb_questions (version_id, qid, module_code, type, text_en, text_hi, reverse, scored, path, sort, is_protected, source_note)
  SELECT p_to, qid, module_code, type, text_en, text_hi, reverse, scored, path, sort, is_protected, source_note
  FROM public.qb_questions WHERE version_id = p_from;

  INSERT INTO public.qb_options (version_id, qid, option_code, label_en, label_hi, value, sort)
  SELECT p_to, qid, option_code, label_en, label_hi, value, sort FROM public.qb_options WHERE version_id = p_from;

  INSERT INTO public.qb_texts (version_id, key, module_code, band, text_en, text_hi)
  SELECT p_to, key, module_code, band, text_en, text_hi FROM public.qb_texts WHERE version_id = p_from;

  INSERT INTO public.qb_item_texts (version_id, qid, kind, trigger, text_en, text_hi)
  SELECT p_to, qid, kind, trigger, text_en, text_hi FROM public.qb_item_texts WHERE version_id = p_from;

  INSERT INTO public.qb_tiers (version_id, sessions, plan_en, plan_hi, pace_en, pace_hi, typical_case)
  SELECT p_to, sessions, plan_en, plan_hi, pace_en, pace_hi, typical_case FROM public.qb_tiers WHERE version_id = p_from;

  INSERT INTO public.qb_scoring (version_id, scale, bands, rounding, core_module, gate, "primary", tier_thresholds, pace, progress, registration)
  SELECT p_to, scale, bands, rounding, core_module, gate, "primary", tier_thresholds, pace, progress, registration
  FROM public.qb_scoring WHERE version_id = p_from;

  INSERT INTO public.qb_point_rules (version_id, key, label, source, qid, points, condition, sort)
  SELECT p_to, key, label, source, qid, points, condition, sort FROM public.qb_point_rules WHERE version_id = p_from;

  INSERT INTO public.qb_overrides (version_id, key, label, condition, action, sessions, sort)
  SELECT p_to, key, label, condition, action, sessions, sort FROM public.qb_overrides WHERE version_id = p_from;

  INSERT INTO public.qb_visibility_rules (version_id, qid, condition)
  SELECT p_to, qid, condition FROM public.qb_visibility_rules WHERE version_id = p_from;

  INSERT INTO public.qb_option_rules (version_id, qid, option_code, kind, condition, sort)
  SELECT p_to, qid, option_code, kind, condition, sort FROM public.qb_option_rules WHERE version_id = p_from;

  INSERT INTO public.qb_flags (version_id, key, condition, effects, is_protected, sort)
  SELECT p_to, key, condition, effects, is_protected, sort FROM public.qb_flags WHERE version_id = p_from;

  INSERT INTO public.qb_format_rules (version_id, key, condition, format, split, add_text_key, sort)
  SELECT p_to, key, condition, format, split, add_text_key, sort FROM public.qb_format_rules WHERE version_id = p_from;

  INSERT INTO public.qb_report_rules (version_id, strengths, stuck, focus, tone, interpretation, layouts, format_texts, report_language)
  SELECT p_to, strengths, stuck, focus, tone, interpretation, layouts, format_texts, report_language
  FROM public.qb_report_rules WHERE version_id = p_from;

  INSERT INTO public.qb_test_cases (version_id, name, source, context, answers, expected, verified, notes)
  SELECT p_to, name, source, context, answers, expected, verified, notes FROM public.qb_test_cases WHERE version_id = p_from;
END;
$$;

-- Fails with a clear message when the test already has a draft or a version in review.
CREATE OR REPLACE FUNCTION public.qb_assert_no_open_version(p_test_code text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label text;
  v_status text;
BEGIN
  SELECT version_label, status INTO v_label, v_status
  FROM public.qb_versions WHERE test_code = p_test_code AND status IN ('draft', 'in_review');
  IF FOUND THEN
    RAISE EXCEPTION '% already has version % (%). Publish, return or delete it before starting another.',
      p_test_code, v_label, replace(v_status, '_', ' ') USING ERRCODE = '23505';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.qb_start_new_version(p_test_code text, p_version_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.qb_versions%ROWTYPE;
  v_new uuid;
BEGIN
  PERFORM public.qb_assert_can_edit();
  IF NOT EXISTS (SELECT 1 FROM public.qb_tests WHERE code = p_test_code) THEN
    RAISE EXCEPTION 'Unknown test %.', p_test_code;
  END IF;
  PERFORM public.qb_assert_no_open_version(p_test_code);
  IF EXISTS (SELECT 1 FROM public.qb_versions WHERE test_code = p_test_code AND version_label = p_version_label) THEN
    RAISE EXCEPTION '% version % already exists.', p_test_code, p_version_label USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_source FROM public.qb_versions
  WHERE test_code = p_test_code
  ORDER BY (status = 'live') DESC, created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% has no version to copy. Import a workbook instead.', p_test_code;
  END IF;

  INSERT INTO public.qb_versions (test_code, version_label, status, based_on_version_id, source_file_name, source_checksum, created_by)
  VALUES (p_test_code, p_version_label, 'draft', v_source.id, v_source.source_file_name, v_source.source_checksum,
          public.get_current_staff_profile_id())
  RETURNING id INTO v_new;

  PERFORM public.qb_copy_version_rows(v_source.id, v_new);
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.qb_submit_for_review(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.qb_assert_can_edit();
  SELECT status INTO v_status FROM public.qb_versions WHERE id = p_version_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Version % not found.', p_version_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft can be submitted for review (this version is %).', replace(v_status, '_', ' ');
  END IF;
  PERFORM public.qb_raise_if_invalid(p_version_id);

  PERFORM set_config('qb.workflow', 'on', true);
  UPDATE public.qb_versions
  SET status = 'in_review', submitted_by = public.get_current_staff_profile_id(), submitted_at = now()
  WHERE id = p_version_id;
  PERFORM set_config('qb.workflow', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.qb_return_to_draft(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT (public.qb_is_trusted_caller() OR public.can_edit_content() OR public.can_approve_content()) THEN
    RAISE EXCEPTION 'You do not have permission to change question bank versions.' USING ERRCODE = '42501';
  END IF;
  SELECT status INTO v_status FROM public.qb_versions WHERE id = p_version_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Version % not found.', p_version_id;
  END IF;
  IF v_status <> 'in_review' THEN
    RAISE EXCEPTION 'Only a version in review can return to draft (this version is %).', replace(v_status, '_', ' ');
  END IF;

  PERFORM set_config('qb.workflow', 'on', true);
  UPDATE public.qb_versions SET status = 'draft', submitted_by = NULL, submitted_at = NULL WHERE id = p_version_id;
  PERFORM set_config('qb.workflow', 'off', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.qb_publish(p_version_id uuid, p_change_note text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version public.qb_versions%ROWTYPE;
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

CREATE OR REPLACE FUNCTION public.qb_delete_draft(p_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  PERFORM public.qb_assert_can_edit();
  SELECT status INTO v_status FROM public.qb_versions WHERE id = p_version_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Version % not found.', p_version_id;
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Only drafts can be deleted (this version is %).', replace(v_status, '_', ' ');
  END IF;
  -- Rows cascade from qb_versions; the freeze trigger allows it because the version is a draft.
  DELETE FROM public.qb_versions WHERE id = p_version_id;
END;
$$;

-- Creates a new draft with all content, rules and test cases from one payload, in one transaction.
-- Payload shape: ImportPayload in packages/questionbank/src/types.ts.
CREATE OR REPLACE FUNCTION public.qb_import_version(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_test text := payload ->> 'test_code';
  v_label text := payload ->> 'version_label';
  v_based_on uuid;
  v_id uuid;
BEGIN
  PERFORM public.qb_assert_can_edit();
  IF v_test IS NULL OR NOT EXISTS (SELECT 1 FROM public.qb_tests WHERE code = v_test) THEN
    RAISE EXCEPTION 'Unknown test %.', coalesce(v_test, '(none)');
  END IF;
  IF coalesce(v_label, '') = '' THEN
    RAISE EXCEPTION 'The payload has no version_label.';
  END IF;
  PERFORM public.qb_assert_no_open_version(v_test);
  IF EXISTS (SELECT 1 FROM public.qb_versions WHERE test_code = v_test AND version_label = v_label) THEN
    RAISE EXCEPTION '% version % already exists.', v_test, v_label USING ERRCODE = '23505';
  END IF;

  SELECT id INTO v_based_on FROM public.qb_versions
  WHERE test_code = v_test
  ORDER BY (status = 'live') DESC, created_at DESC
  LIMIT 1;

  INSERT INTO public.qb_versions (test_code, version_label, status, based_on_version_id, change_note, source_file_name, source_checksum, created_by)
  VALUES (v_test, v_label, 'draft', v_based_on, nullif(btrim(payload ->> 'change_note'), ''),
          payload ->> 'source_file_name', payload ->> 'source_checksum', public.get_current_staff_profile_id())
  RETURNING id INTO v_id;

  INSERT INTO public.qb_modules (version_id, code, name_en, name_hi, kind, sort)
  SELECT v_id, x.code, x.name_en, x.name_hi, x.kind, x.sort
  FROM jsonb_to_recordset(payload -> 'modules') AS x(code text, name_en text, name_hi text, kind text, sort integer);

  INSERT INTO public.qb_questions (version_id, qid, module_code, type, text_en, text_hi, reverse, scored, path, sort, is_protected, source_note)
  SELECT v_id, x.qid, x.module_code, x.type, x.text_en, x.text_hi, coalesce(x.reverse, false), x.scored,
         coalesce(x.path, 'all'), x.sort, coalesce(x.is_protected, false), x.source_note
  FROM jsonb_to_recordset(payload -> 'questions') AS x(
    qid text, module_code text, type text, text_en text, text_hi text, reverse boolean, scored text,
    path text, sort integer, is_protected boolean, source_note text
  );

  INSERT INTO public.qb_options (version_id, qid, option_code, label_en, label_hi, value, sort)
  SELECT v_id, x.qid, x.option_code, x.label_en, x.label_hi, x.value, x.sort
  FROM jsonb_to_recordset(payload -> 'options') AS x(qid text, option_code text, label_en text, label_hi text, value integer, sort integer);

  INSERT INTO public.qb_texts (version_id, key, module_code, band, text_en, text_hi)
  SELECT v_id, x.key, x.module_code, x.band, x.text_en, x.text_hi
  FROM jsonb_to_recordset(payload -> 'texts') AS x(key text, module_code text, band text, text_en text, text_hi text);

  INSERT INTO public.qb_item_texts (version_id, qid, kind, trigger, text_en, text_hi)
  SELECT v_id, x.qid, x.kind, x.trigger, x.text_en, x.text_hi
  FROM jsonb_to_recordset(payload -> 'item_texts') AS x(qid text, kind text, trigger text, text_en text, text_hi text);

  INSERT INTO public.qb_tiers (version_id, sessions, plan_en, plan_hi, pace_en, pace_hi, typical_case)
  SELECT v_id, x.sessions, x.plan_en, x.plan_hi, x.pace_en, x.pace_hi, x.typical_case
  FROM jsonb_to_recordset(payload -> 'tiers') AS x(sessions integer, plan_en text, plan_hi text, pace_en text, pace_hi text, typical_case text);

  INSERT INTO public.qb_scoring (version_id, scale, bands, rounding, core_module, gate, "primary", tier_thresholds, pace, progress, registration)
  SELECT v_id, s -> 'scale', s -> 'bands', coalesce(s ->> 'rounding', 'half_up'), s -> 'core_module', s -> 'gate',
         s -> 'primary', s -> 'tier_thresholds', s -> 'pace', s -> 'progress', s -> 'registration'
  FROM (SELECT payload -> 'scoring' AS s) AS src
  WHERE s IS NOT NULL;

  INSERT INTO public.qb_point_rules (version_id, key, label, source, qid, points, condition, sort)
  SELECT v_id, x.key, x.label, x.source, x.qid, x.points, nullif(x.condition, 'null'::jsonb), x.sort
  FROM jsonb_to_recordset(payload -> 'point_rules') AS x(key text, label text, source text, qid text, points integer, condition jsonb, sort integer);

  INSERT INTO public.qb_overrides (version_id, key, label, condition, action, sessions, sort)
  SELECT v_id, x.key, x.label, x.condition, x.action, x.sessions, x.sort
  FROM jsonb_to_recordset(payload -> 'overrides') AS x(key text, label text, condition jsonb, action text, sessions integer, sort integer);

  INSERT INTO public.qb_visibility_rules (version_id, qid, condition)
  SELECT v_id, x.qid, x.condition
  FROM jsonb_to_recordset(payload -> 'visibility_rules') AS x(qid text, condition jsonb);

  INSERT INTO public.qb_option_rules (version_id, qid, option_code, kind, condition, sort)
  SELECT v_id, x.qid, x.option_code, x.kind, x.condition, x.sort
  FROM jsonb_to_recordset(payload -> 'option_rules') AS x(qid text, option_code text, kind text, condition jsonb, sort integer);

  INSERT INTO public.qb_flags (version_id, key, condition, effects, is_protected, sort)
  SELECT v_id, x.key, x.condition, coalesce(x.effects, '{}'::jsonb), coalesce(x.is_protected, false), x.sort
  FROM jsonb_to_recordset(payload -> 'flags') AS x(key text, condition jsonb, effects jsonb, is_protected boolean, sort integer);

  INSERT INTO public.qb_format_rules (version_id, key, condition, format, split, add_text_key, sort)
  SELECT v_id, x.key, x.condition, x.format, nullif(x.split, 'null'::jsonb), x.add_text_key, x.sort
  FROM jsonb_to_recordset(payload -> 'format_rules') AS x(key text, condition jsonb, format text, split jsonb, add_text_key text, sort integer);

  INSERT INTO public.qb_report_rules (version_id, strengths, stuck, focus, tone, interpretation, layouts, format_texts, report_language)
  SELECT v_id, r -> 'strengths', r -> 'stuck', r -> 'focus', r -> 'tone', r -> 'interpretation', r -> 'layouts',
         coalesce(r -> 'format_texts', '{}'::jsonb), r -> 'report_language'
  FROM (SELECT payload -> 'report_rules' AS r) AS src
  WHERE r IS NOT NULL;

  INSERT INTO public.qb_test_cases (version_id, name, source, context, answers, expected, verified, notes)
  SELECT v_id, x.name, x.source, x.context, x.answers, x.expected, coalesce(x.verified, false), x.notes
  FROM jsonb_to_recordset(coalesce(payload -> 'test_cases', '[]'::jsonb)) AS x(
    name text, source text, context jsonb, answers jsonb, expected jsonb, verified boolean, notes text
  );

  -- Anything invalid fails the whole import.
  PERFORM public.qb_raise_if_invalid(v_id);
  RETURN v_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'qb_tests', 'qb_versions', 'qb_modules', 'qb_questions', 'qb_options', 'qb_texts', 'qb_item_texts',
    'qb_tiers', 'qb_scoring', 'qb_point_rules', 'qb_overrides', 'qb_visibility_rules', 'qb_option_rules',
    'qb_flags', 'qb_format_rules', 'qb_report_rules', 'qb_test_cases', 'qb_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END;
$$;

-- Tests: every signed-in user. Versions: staff see all; clients see live versions only.
DROP POLICY IF EXISTS qb_tests_select ON public.qb_tests;
CREATE POLICY qb_tests_select ON public.qb_tests FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS qb_versions_select ON public.qb_versions;
CREATE POLICY qb_versions_select ON public.qb_versions FOR SELECT TO authenticated
  USING (public.is_active_staff() OR status = 'live');

-- Modules, questions, options: staff see all versions; clients see live versions only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qb_modules', 'qb_questions', 'qb_options'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY %1$s_select ON public.%1$I FOR SELECT TO authenticated USING ('
      '  public.is_active_staff() OR EXISTS ('
      '    SELECT 1 FROM public.qb_versions v WHERE v.id = %1$I.version_id AND v.status = ''live''))',
      t
    );
  END LOOP;

  -- Texts, rules, flags, test cases: staff only. Never clients.
  FOREACH t IN ARRAY ARRAY[
    'qb_texts', 'qb_item_texts', 'qb_tiers', 'qb_scoring', 'qb_point_rules', 'qb_overrides',
    'qb_visibility_rules', 'qb_option_rules', 'qb_flags', 'qb_format_rules', 'qb_report_rules', 'qb_test_cases'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_select ON public.%1$I', t);
    EXECUTE format('CREATE POLICY %1$s_select ON public.%1$I FOR SELECT TO authenticated USING (public.is_active_staff())', t);
  END LOOP;

  -- Editors write content, rules and test cases. The freeze trigger still limits writes to drafts.
  FOREACH t IN ARRAY ARRAY[
    'qb_modules', 'qb_questions', 'qb_options', 'qb_texts', 'qb_item_texts', 'qb_tiers', 'qb_scoring',
    'qb_point_rules', 'qb_overrides', 'qb_visibility_rules', 'qb_option_rules', 'qb_flags',
    'qb_format_rules', 'qb_report_rules', 'qb_test_cases'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %1$s_insert ON public.%1$I', t);
    EXECUTE format('CREATE POLICY %1$s_insert ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.can_edit_content())', t);
    EXECUTE format('DROP POLICY IF EXISTS %1$s_update ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY %1$s_update ON public.%1$I FOR UPDATE TO authenticated '
      'USING (public.can_edit_content()) WITH CHECK (public.can_edit_content())',
      t
    );
    EXECUTE format('DROP POLICY IF EXISTS %1$s_delete ON public.%1$I', t);
    EXECUTE format('CREATE POLICY %1$s_delete ON public.%1$I FOR DELETE TO authenticated USING (public.can_edit_content())', t);
  END LOOP;
END;
$$;

-- Audit log: staff read; only the audit trigger writes (no write policies).
DROP POLICY IF EXISTS qb_audit_log_select ON public.qb_audit_log;
CREATE POLICY qb_audit_log_select ON public.qb_audit_log FOR SELECT TO authenticated USING (public.is_active_staff());

-- qb_tests and qb_versions have no write policies: versions change only through the workflow functions.

-- ------------------------------------------------------------------------------
-- 10. FUNCTION PRIVILEGES
-- ------------------------------------------------------------------------------

DO $$
DECLARE
  fn text;
  has_anon boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon');
  has_auth boolean := EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated');
BEGIN
  -- Callable by signed-in staff (each checks permissions itself).
  FOREACH fn IN ARRAY ARRAY[
    'public.can_edit_content()', 'public.can_approve_content()', 'public.qb_validate_version(uuid)',
    'public.qb_start_new_version(text, text)', 'public.qb_submit_for_review(uuid)',
    'public.qb_return_to_draft(uuid)', 'public.qb_publish(uuid, text)', 'public.qb_delete_draft(uuid)',
    'public.qb_import_version(jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); END IF;
    IF has_auth THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn); END IF;
  END LOOP;

  -- Internal helpers: not callable through the API.
  FOREACH fn IN ARRAY ARRAY[
    'public.qb_is_trusted_caller()', 'public.qb_condition_refs(jsonb)', 'public.qb_assert_can_edit()',
    'public.qb_assert_can_approve()', 'public.qb_raise_if_invalid(uuid)', 'public.qb_copy_version_rows(uuid, uuid)',
    'public.qb_assert_no_open_version(text)', 'public.qb_freeze_guard()', 'public.qb_version_guard()',
    'public.qb_audit()', 'public.qb_guard_content_permissions()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    IF has_anon THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); END IF;
    IF has_auth THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', fn); END IF;
  END LOOP;
END;
$$;

COMMIT;

-- ==============================================================================
-- MFB Assessments — Question bank rule decisions (Task 03b)
--
-- Schema support for the owner's decisions (docs/questionbank/decisions.md):
--   * qb_options.exclusive ("None of these" cannot be combined with other options) — D2
--   * qb_tests: Hindi names (D15) and progress assessment names (D17), test level (not versioned)
--   * qb_validate_version: exclusive options, gate min_choices (D12), printed flags need a text,
--     notify recipients (D19), interpretation fallback (D13), catch-all format warning; protected
--     flags may gain effects (e.g. a notify recipient) but never lose or change one
--   * qb_copy_version_rows / qb_import_version copy and import the exclusive flag
-- The new versions IA 1.2 / MA 1.1 are created by supabase/seed/question-bank/*.patch-and-publish.sql.
--
-- One transaction (BEGIN ... COMMIT): paste the whole file into the Supabase SQL Editor and run.
-- Run after 20261016000000_question_bank.sql. Run order: docs/tasks/03b-apply.md.
--
-- ROLLBACK (manual): re-run the qb_validate_version, qb_copy_version_rows and qb_import_version
--   definitions from 20261016000000_question_bank.sql; then
--   DROP FUNCTION IF EXISTS public.qb_effects_kept(jsonb, jsonb);
--   ALTER TABLE public.qb_tests DROP COLUMN IF EXISTS progress_name_en, DROP COLUMN IF EXISTS progress_name_hi;
--   UPDATE public.qb_tests SET name_hi = NULL;
--   ALTER TABLE public.qb_options DROP COLUMN IF EXISTS exclusive;
--   (only possible before any version uses exclusive = true)
-- ==============================================================================

BEGIN;

-- 1. EXCLUSIVE OPTIONS (D2). Adding a column fires no row triggers, so frozen versions are untouched.
ALTER TABLE public.qb_options ADD COLUMN IF NOT EXISTS exclusive boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.qb_options.exclusive IS 'Multi-select only: this option cannot be combined with others (e.g. None of these)';

-- 2. TEST-LEVEL NAMES (D15, D17). Not versioned; qb_tests has no freeze trigger.
ALTER TABLE public.qb_tests
  ADD COLUMN IF NOT EXISTS progress_name_en text,
  ADD COLUMN IF NOT EXISTS progress_name_hi text;
COMMENT ON COLUMN public.qb_tests.progress_name_hi IS 'Hindi progress assessment name — pending Hindi review (decision D17)';

-- D15: Hindi name = the part of the Hindi TITLE text before " —".
UPDATE public.qb_tests SET
  name_hi = 'MFB इंटिमेसी असेसमेंट',
  progress_name_en = 'MFB Intimacy Progress Assessment',
  progress_name_hi = 'MFB इंटिमेसी प्रोग्रेस असेसमेंट'
WHERE code = 'IA';
UPDATE public.qb_tests SET
  name_hi = 'MFB माइंड असेसमेंट',
  progress_name_en = 'MFB Mind Progress Assessment',
  progress_name_hi = 'MFB माइंड प्रोग्रेस असेसमेंट'
WHERE code = 'MA';

-- 3. PROTECTED FLAGS: every effect of p_before is still present in p_after; arrays may only grow.
CREATE OR REPLACE FUNCTION public.qb_effects_kept(p_before jsonb, p_after jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(bool_and(coalesce(
    CASE
      WHEN jsonb_typeof(b.value) = 'array'
        THEN jsonb_typeof(p_after -> b.key) = 'array' AND (p_after -> b.key) @> b.value
      ELSE (p_after -> b.key) = b.value
    END, false)), true)
  FROM jsonb_each(coalesce(p_before, '{}'::jsonb)) AS b;
$$;

-- 4. VALIDATION (adds the Task 03b checks; everything else unchanged)
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

  -- Gate option codes are module codes (choosing option C chooses module C).
  RETURN QUERY
    SELECT 'error', 'gate_option_module', format('Gate option %s is not a couple or individual module.', o.option_code), o.option_code
    FROM public.qb_scoring s
    JOIN public.qb_options o ON o.version_id = s.version_id AND o.qid = s.gate ->> 'qid'
    WHERE s.version_id = p_version_id
      AND NOT EXISTS (
        SELECT 1 FROM public.qb_modules m
        WHERE m.version_id = p_version_id AND m.code = o.option_code AND m.kind IN ('couple', 'individual')
      );

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
        AND (f.condition IS DISTINCT FROM old.condition OR NOT public.qb_effects_kept(old.effects, f.effects) OR NOT f.is_protected);
  END IF;

  -- Task 03b: exclusive options only on multi-select questions, at most one per question.
  RETURN QUERY
    SELECT 'error', 'exclusive_not_multi', format('%s is %s; only multi-select questions can have an exclusive option.', q.qid, q.type), q.qid
    FROM public.qb_questions q
    WHERE q.version_id = p_version_id AND q.type <> 'multi'
      AND EXISTS (SELECT 1 FROM public.qb_options o WHERE o.version_id = q.version_id AND o.qid = q.qid AND o.exclusive)
    UNION ALL
    SELECT 'error', 'exclusive_many', format('%s has more than one exclusive option.', o.qid), o.qid
    FROM public.qb_options o
    WHERE o.version_id = p_version_id AND o.exclusive
    GROUP BY o.qid HAVING count(*) > 1;

  -- Task 03b: the gate needs min_choices between 1 and max_choices.
  RETURN QUERY
    SELECT 'error', 'gate_min_choices',
           CASE WHEN NOT (s.gate ? 'min_choices') THEN 'The gate has no min_choices (at least 1 choice is required).'
                ELSE format('Gate min_choices must be between 1 and max_choices (%s).', s.gate ->> 'max_choices') END,
           s.gate ->> 'qid'
    FROM public.qb_scoring s
    WHERE s.version_id = p_version_id
      AND (NOT (s.gate ? 'min_choices')
           OR jsonb_typeof(s.gate -> 'min_choices') <> 'number'
           OR (s.gate ->> 'min_choices')::numeric < 1
           OR (s.gate ->> 'min_choices')::numeric > (s.gate ->> 'max_choices')::numeric);

  -- Task 03b: a printed flag needs its text (the report_block text, or a text keyed by the flag).
  RETURN QUERY
    SELECT 'error', 'flag_text_missing', format('Flag %s is printed but has no text (add a text or set printed: false).', f.key), f.key
    FROM public.qb_flags f
    WHERE f.version_id = p_version_id
      AND coalesce(f.effects -> 'printed', 'true'::jsonb) <> 'false'::jsonb
      AND NOT EXISTS (
        SELECT 1 FROM public.qb_texts t
        WHERE t.version_id = p_version_id AND t.key IN (f.key, coalesce(f.effects ->> 'report_block', f.key))
      );

  -- Task 03b: notify recipients are coordinator and counsellor only.
  RETURN QUERY
    SELECT 'error', 'notify_recipient', format('Flag %s notifies unknown recipient %s.', f.key, x), f.key
    FROM public.qb_flags f, jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(f.effects -> 'notify') = 'array' THEN f.effects -> 'notify' ELSE '[]'::jsonb END
    ) x
    WHERE f.version_id = p_version_id AND x NOT IN ('coordinator', 'counsellor');

  -- Task 03b: interpretation fallback is "core" or "none".
  RETURN QUERY
    SELECT 'error', 'interpretation_fallback', 'Report rules: interpretation.fallback must be "core" or "none".', NULL::text
    FROM public.qb_report_rules r
    WHERE r.version_id = p_version_id
      AND coalesce(r.interpretation ->> 'fallback', '') NOT IN ('core', 'none');

  -- Task 03b: warn when the last format rule is not a catch-all ({"all": []}).
  RETURN QUERY
    SELECT 'warning', 'format_no_catch_all',
           'The last format rule is not a catch-all ({ all: [] }); some clients may get no format.', last.key
    FROM (
      SELECT f.key, f.condition FROM public.qb_format_rules f
      WHERE f.version_id = p_version_id ORDER BY f.sort DESC LIMIT 1
    ) last
    WHERE last.condition IS DISTINCT FROM '{"all": []}'::jsonb;

  -- Test cases refer to real questions (warning: they are verified separately).
  RETURN QUERY
    SELECT 'warning', 'test_case_qid', format('Test case "%s" answers unknown question %s.', t.name, a.key), a.key
    FROM public.qb_test_cases t, jsonb_each(t.answers) a
    WHERE t.version_id = p_version_id
      AND NOT EXISTS (SELECT 1 FROM public.qb_questions q WHERE q.version_id = p_version_id AND q.qid = a.key);
END;
$$;

-- 5. COPYING A VERSION (now includes exclusive)
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

  INSERT INTO public.qb_options (version_id, qid, option_code, label_en, label_hi, value, sort, exclusive)
  SELECT p_to, qid, option_code, label_en, label_hi, value, sort, exclusive FROM public.qb_options WHERE version_id = p_from;

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

-- 6. IMPORT (now includes exclusive)
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

  INSERT INTO public.qb_options (version_id, qid, option_code, label_en, label_hi, value, sort, exclusive)
  SELECT v_id, x.qid, x.option_code, x.label_en, x.label_hi, x.value, x.sort, coalesce(x.exclusive, false)
  FROM jsonb_to_recordset(payload -> 'options') AS x(
    qid text, option_code text, label_en text, label_hi text, value integer, sort integer, exclusive boolean
  );

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

-- 7. PRIVILEGES (CREATE OR REPLACE keeps existing grants; the new helper is internal)
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public.qb_effects_kept(jsonb, jsonb) FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.qb_effects_kept(jsonb, jsonb) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.qb_effects_kept(jsonb, jsonb) FROM authenticated;
  END IF;
END;
$$;

COMMIT;

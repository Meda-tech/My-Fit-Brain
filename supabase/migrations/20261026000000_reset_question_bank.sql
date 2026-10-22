-- ==============================================================================================
-- Task 11, Step 1 — ONE-TIME RESET (development data). Run once in the Supabase SQL Editor, before
-- 20261026000001_questionnaires.sql. This file DELETES data. Read the list before running it.
--
-- TABLES DROPPED (every row, trigger, policy and index of each):
--   Question bank (20):
--     qb_version_definitions, qb_test_runs, qb_test_cases, qb_report_rules, qb_format_rules, qb_flags,
--     qb_option_rules, qb_visibility_rules, qb_overrides, qb_point_rules, qb_scoring, qb_tiers,
--     qb_item_texts, qb_texts, qb_options, qb_questions, qb_modules, qb_audit_log, qb_versions, qb_tests
--   Assessments (test data; rebuilt with a new shape by the next file):
--     attempt_events, attempt_answers, attempt_results, attempts
--
-- ROWS DELETED, TABLE KEPT (test payments only):
--     payments, payment_events
--
-- FUNCTIONS DROPPED:
--   Question bank: qb_is_trusted_caller, can_edit_content, can_approve_content, qb_guard_content_permissions,
--     qb_freeze_guard, qb_version_guard, qb_audit, qb_condition_refs, qb_validate_version, qb_assert_can_edit,
--     qb_assert_can_approve, qb_raise_if_invalid, qb_copy_version_rows, qb_assert_no_open_version,
--     qb_start_new_version, qb_submit_for_review, qb_return_to_draft, qb_publish (both signatures),
--     qb_delete_draft, qb_import_version, qb_effects_kept, qb_record_test_runs, qb_definition_guard,
--     qb_validate_definition, qb_label_parts, qb_create_draft_from_definition, qb_replace_draft_definition,
--     qb_definition_without_labels
--   Assessments (recreated by the next file): next_report_id, create_paid_attempt, attempt_guard,
--     attempt_answer_guard, attempt_result_guard
--
-- OTHER CHANGES:
--   profiles: the trigger trg_profiles_content_permissions is dropped (it belonged to the question bank).
--     No profile row is changed; the columns can_edit_content / can_approve_content stay (unused).
--   report_counters: rows are NOT touched. Only its foreign key to qb_tests is removed, because qb_tests
--     is dropped. Report numbers continue from where they are.
--   payments: its foreign keys to qb_tests and attempts are removed here and re-created by the next file.
--
-- NOT TOUCHED: clients, profiles rows, auth, custom_send_sms (SMS hook), vault, report_counters rows,
--   is_active_staff, is_super_admin, is_counsellor, get_current_staff_profile_id, link_client_phone,
--   can_view_reports, can_view_payments, handle_updated_at, payment_guard and the payments policies.
-- ==============================================================================================

BEGIN;

-- 1. Foreign keys from kept tables to tables that go (found by name, whatever they were called).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.conrelid IN (to_regclass('public.payments'), to_regclass('public.report_counters'))
      AND c.confrelid IN (to_regclass('public.qb_tests'), to_regclass('public.qb_versions'), to_regclass('public.attempts'))
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END;
$$;

-- 2. Test payments (the guard forbids DELETE; it is paused for this statement only).
ALTER TABLE public.payments DISABLE TRIGGER trg_payments_guard;
DELETE FROM public.payment_events;
DELETE FROM public.payments;
ALTER TABLE public.payments ENABLE TRIGGER trg_payments_guard;

-- 3. Old assessment tables (test data) and their functions.
DROP TABLE IF EXISTS public.attempt_events;
DROP TABLE IF EXISTS public.attempt_answers;
DROP TABLE IF EXISTS public.attempt_results;
DROP TABLE IF EXISTS public.attempts;
DROP FUNCTION IF EXISTS public.create_paid_attempt(uuid, text, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.next_report_id(text);
DROP FUNCTION IF EXISTS public.attempt_guard();
DROP FUNCTION IF EXISTS public.attempt_answer_guard();
DROP FUNCTION IF EXISTS public.attempt_result_guard();

-- 4. The question-bank trigger on profiles (its function is dropped below).
DROP TRIGGER IF EXISTS trg_profiles_content_permissions ON public.profiles;

-- 5. Question-bank tables, children first.
DROP TABLE IF EXISTS public.qb_version_definitions;
DROP TABLE IF EXISTS public.qb_test_runs;
DROP TABLE IF EXISTS public.qb_test_cases;
DROP TABLE IF EXISTS public.qb_report_rules;
DROP TABLE IF EXISTS public.qb_format_rules;
DROP TABLE IF EXISTS public.qb_flags;
DROP TABLE IF EXISTS public.qb_option_rules;
DROP TABLE IF EXISTS public.qb_visibility_rules;
DROP TABLE IF EXISTS public.qb_overrides;
DROP TABLE IF EXISTS public.qb_point_rules;
DROP TABLE IF EXISTS public.qb_scoring;
DROP TABLE IF EXISTS public.qb_tiers;
DROP TABLE IF EXISTS public.qb_item_texts;
DROP TABLE IF EXISTS public.qb_texts;
DROP TABLE IF EXISTS public.qb_options;
DROP TABLE IF EXISTS public.qb_questions;
DROP TABLE IF EXISTS public.qb_modules;
DROP TABLE IF EXISTS public.qb_audit_log;
DROP TABLE IF EXISTS public.qb_versions;
DROP TABLE IF EXISTS public.qb_tests;

-- 6. Question-bank functions.
DROP FUNCTION IF EXISTS public.qb_is_trusted_caller();
DROP FUNCTION IF EXISTS public.can_edit_content();
DROP FUNCTION IF EXISTS public.can_approve_content();
DROP FUNCTION IF EXISTS public.qb_guard_content_permissions();
DROP FUNCTION IF EXISTS public.qb_freeze_guard();
DROP FUNCTION IF EXISTS public.qb_version_guard();
DROP FUNCTION IF EXISTS public.qb_audit();
DROP FUNCTION IF EXISTS public.qb_condition_refs(jsonb);
DROP FUNCTION IF EXISTS public.qb_validate_version(uuid);
DROP FUNCTION IF EXISTS public.qb_assert_can_edit();
DROP FUNCTION IF EXISTS public.qb_assert_can_approve();
DROP FUNCTION IF EXISTS public.qb_raise_if_invalid(uuid);
DROP FUNCTION IF EXISTS public.qb_copy_version_rows(uuid, uuid);
DROP FUNCTION IF EXISTS public.qb_assert_no_open_version(text);
DROP FUNCTION IF EXISTS public.qb_start_new_version(text, text);
DROP FUNCTION IF EXISTS public.qb_submit_for_review(uuid);
DROP FUNCTION IF EXISTS public.qb_return_to_draft(uuid);
DROP FUNCTION IF EXISTS public.qb_publish(uuid, text);
DROP FUNCTION IF EXISTS public.qb_publish(uuid, text, text);
DROP FUNCTION IF EXISTS public.qb_delete_draft(uuid);
DROP FUNCTION IF EXISTS public.qb_import_version(jsonb);
DROP FUNCTION IF EXISTS public.qb_effects_kept(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.qb_record_test_runs(uuid, jsonb);
DROP FUNCTION IF EXISTS public.qb_definition_guard();
DROP FUNCTION IF EXISTS public.qb_validate_definition(uuid);
DROP FUNCTION IF EXISTS public.qb_label_parts(text);
DROP FUNCTION IF EXISTS public.qb_create_draft_from_definition(jsonb, text);
DROP FUNCTION IF EXISTS public.qb_replace_draft_definition(uuid, jsonb);
DROP FUNCTION IF EXISTS public.qb_definition_without_labels(jsonb);

COMMIT;

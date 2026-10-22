-- Task 11 — checks after running 20261026000000_reset_question_bank.sql and 20261026000001_questionnaires.sql.
-- Read-only: every statement is a SELECT.

-- 1. Nothing from the question bank is left (expect 0 rows).
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'qb\_%' ORDER BY 1;

SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name LIKE 'qb\_%' ORDER BY 1;

-- 2. The new tables exist (expect 6 rows).
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('questionnaires', 'questionnaire_versions', 'attempts', 'attempt_answers', 'attempt_results', 'attempt_alerts')
ORDER BY 1;

-- 3. Seeded questionnaires (expect IA and MA).
SELECT code, name_en, report_prefix, sort FROM public.questionnaires ORDER BY sort;

-- 4. Kept as they were: clients, profiles, report_counters (counts only).
SELECT (SELECT count(*) FROM public.clients) AS clients,
       (SELECT count(*) FROM public.profiles) AS profiles,
       (SELECT count(*) FROM public.report_counters) AS report_counter_rows,
       (SELECT count(*) FROM public.payments) AS payments_should_be_0,
       (SELECT count(*) FROM public.payment_events) AS payment_events_should_be_0;

-- 5. Foreign keys of payments and report_counters (expect payments → questionnaires, payments → attempts; none on report_counters).
SELECT c.conrelid::regclass AS table_name, c.conname, c.confrelid::regclass AS references_table
FROM pg_constraint c
WHERE c.contype = 'f' AND c.conrelid IN ('public.payments'::regclass, 'public.report_counters'::regclass)
ORDER BY 1, 2;

-- 6. RLS is on for every new table (expect rowsecurity = true for all 6).
SELECT relname, relrowsecurity FROM pg_class
WHERE relnamespace = 'public'::regnamespace
  AND relname IN ('questionnaires', 'questionnaire_versions', 'attempts', 'attempt_answers', 'attempt_results', 'attempt_alerts')
ORDER BY 1;

-- 7. Functions in place (expect 3 rows).
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('next_report_id', 'create_paid_attempt', 'publish_questionnaire_version')
ORDER BY 1;

-- 8. The profiles trigger of the old question bank is gone (expect 0 rows).
SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND tgname = 'trg_profiles_content_permissions';

-- 9. Versions after importing the starting drafts (expect one draft or live row per questionnaire).
SELECT questionnaire_code, number, status, created_at, published_at FROM public.questionnaire_versions ORDER BY 1, 2;

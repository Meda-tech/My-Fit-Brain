-- ==============================================================================================
-- LAUNCH CLEANUP — ONE TIME. Removes all test data before going live. Owner request 2026-10-31.
--
-- THIS FILE DELETES DATA. It cannot be undone. Read the lists below before running it.
-- Run docs/tasks/17-launch-cleanup-verify.sql FIRST to see exactly what will go, then this file,
-- then the verify file again (expect zeros).
--
-- ROWS DELETED (every row; the tables themselves stay):
--   Payments:     payments, payment_events, payment_moves
--   Assessments:  attempts, attempt_answers, attempt_results, attempt_alerts, attempt_details
--   Report IDs:   report_counters (the next report starts again at MFB-IA-2026-00001 / MFB-MA-2026-00001)
--   Under 18:     age_stops
--   Clients:      clients (all registered clients)
--   Team:         profiles with role coordinator or counsellor
--   Logins:       auth.users — every login EXCEPT the super admins' (all client phone logins and all
--                 coordinator / counsellor logins go; Supabase removes their sessions with them)
--
-- KEPT AS IS (not touched at all):
--   questionnaires (codes, names, On / Off, client details list) and questionnaire_versions (every
--   version, draft / live / retired, with its JSON). Super admin profiles and their logins.
--   SMS hook, Vault, all functions, triggers, policies and table structures.
--
-- ONE EXCEPTION, so the questionnaires stay untouched: a coordinator who imported, published or switched a
--   questionnaire is named on that questionnaire row. That profile is NOT deleted (deleting it would change
--   the questionnaire row); it is switched to inactive and its login is removed, so it can never sign in.
--   The file prints these names as a notice.
--
-- Safety: the file stops and deletes nothing if no active super admin with a login exists.
-- The guards that forbid deleting payments and assessments are paused inside this transaction only and
-- switched back on before COMMIT. If any step fails, nothing is deleted.
-- ==============================================================================================

BEGIN;

-- 0. Stop unless an active super admin can still sign in afterwards.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE role = 'super_admin' AND is_active AND auth_user_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No active super admin with a login was found. Nothing was deleted.';
  END IF;
END;
$$;

-- 1. Pause the no-delete guards (this transaction only).
ALTER TABLE public.payments DISABLE TRIGGER trg_payments_guard;
ALTER TABLE public.attempts DISABLE TRIGGER trg_attempts_guard;
ALTER TABLE public.attempt_answers DISABLE TRIGGER trg_attempt_answers_guard;
ALTER TABLE public.attempt_results DISABLE TRIGGER trg_attempt_results_guard;
ALTER TABLE public.attempt_details DISABLE TRIGGER trg_attempt_details_guard;

-- 2. Payments.
DELETE FROM public.payment_moves;
DELETE FROM public.payment_events;
DELETE FROM public.payments;

-- 3. Assessments.
DELETE FROM public.attempt_details;
DELETE FROM public.attempt_alerts;
DELETE FROM public.attempt_answers;
DELETE FROM public.attempt_results;
DELETE FROM public.attempts;

-- 4. Report numbers start again from 00001.
DELETE FROM public.report_counters;

-- 5. Under-18 records.
DELETE FROM public.age_stops;

-- 6. Clients.
DELETE FROM public.clients;

-- 7. Team: coordinators and counsellors. Those named on a questionnaire row are kept, inactive.
DO $$
DECLARE
  v_names text;
BEGIN
  SELECT string_agg(p.full_name || ' (' || p.email || ')', ', ') INTO v_names
  FROM public.profiles p
  WHERE p.role IN ('coordinator', 'counsellor')
    AND (EXISTS (SELECT 1 FROM public.questionnaire_versions v WHERE p.id IN (v.created_by, v.published_by))
         OR EXISTS (SELECT 1 FROM public.questionnaires q WHERE q.active_changed_by = p.id));
  IF v_names IS NOT NULL THEN
    RAISE NOTICE 'Kept as inactive (named on a questionnaire, login removed): %', v_names;
  END IF;
END;
$$;

UPDATE public.profiles p
SET is_active = false
WHERE p.role IN ('coordinator', 'counsellor')
  AND (EXISTS (SELECT 1 FROM public.questionnaire_versions v WHERE p.id IN (v.created_by, v.published_by))
       OR EXISTS (SELECT 1 FROM public.questionnaires q WHERE q.active_changed_by = p.id));

DELETE FROM public.profiles p
WHERE p.role IN ('coordinator', 'counsellor')
  AND NOT EXISTS (SELECT 1 FROM public.questionnaire_versions v WHERE p.id IN (v.created_by, v.published_by))
  AND NOT EXISTS (SELECT 1 FROM public.questionnaires q WHERE q.active_changed_by = p.id);

-- 8. Logins: every one except the super admins'.
DELETE FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.profiles p
  WHERE p.role = 'super_admin'
    AND (p.auth_user_id = u.id OR lower(p.email) = lower(u.email))
);

-- 9. Guards back on.
ALTER TABLE public.payments ENABLE TRIGGER trg_payments_guard;
ALTER TABLE public.attempts ENABLE TRIGGER trg_attempts_guard;
ALTER TABLE public.attempt_answers ENABLE TRIGGER trg_attempt_answers_guard;
ALTER TABLE public.attempt_results ENABLE TRIGGER trg_attempt_results_guard;
ALTER TABLE public.attempt_details ENABLE TRIGGER trg_attempt_details_guard;

COMMIT;

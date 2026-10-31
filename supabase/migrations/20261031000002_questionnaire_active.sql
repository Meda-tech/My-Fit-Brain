-- ==============================================================================
-- On / Off switch per questionnaire.
--
-- Admin → Questionnaires can switch an assessment off for a while. While it is off, nobody can buy it:
-- the pay link shows "not available right now" and Home hides it. Purchases already paid can still be
-- started, and running assessments can still be finished.
--
-- This file only ADDS. It deletes, drops or truncates nothing. It does:
--   1. questionnaires.is_active            on (true) by default, so every existing questionnaire stays on
--   2. questionnaires.active_changed_at /  who switched it last, and when (shown in the admin)
--      active_changed_by
-- Writes go through the server (service role) after the role check; the RLS policies stay as they are.
--
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/14-questionnaire-active-verify.sql.
-- ==============================================================================

BEGIN;

ALTER TABLE public.questionnaires
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS active_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_changed_by uuid REFERENCES public.profiles (id);

COMMENT ON COLUMN public.questionnaires.is_active IS
  'Off = nobody can buy it (pay link and Home). Paid purchases and running assessments are not affected.';

COMMIT;

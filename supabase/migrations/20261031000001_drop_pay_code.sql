-- ==============================================================================
-- Remove the unused pay link code.
--
-- THIS FILE REMOVES SOMETHING: it drops the column public.questionnaires.pay_code, with its unique
-- index and its format check (all added by 20261031000000_pay_first.sql). The owner approved this
-- removal on 2026-10-31. The column held only random link codes; nothing reads it any more, because
-- the pay link now uses the questionnaire code (/pay/IA). No other data is touched; no row is removed.
--
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/13b-drop-pay-code-verify.sql.
-- ==============================================================================

BEGIN;

ALTER TABLE public.questionnaires DROP CONSTRAINT IF EXISTS questionnaires_pay_code_format;
DROP INDEX IF EXISTS public.uq_questionnaires_pay_code;
ALTER TABLE public.questionnaires DROP COLUMN IF EXISTS pay_code;

COMMIT;

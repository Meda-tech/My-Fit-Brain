-- ==============================================================================================
-- Client details — typed answers asked at the end of an assessment (after the safety questions).
-- Additive: adds one column and one table. Deletes nothing, drops nothing, changes no existing row.
-- Run after 20261026000001_questionnaires.sql.
--
--   questionnaires.client_details   the current list of client-details questions for that test:
--                                   [ { "id": "d_medical", "text": { "en": "…", "hi": "…" } }, … ]
--                                   Not versioned: the admin edits it at any time (super admins and
--                                   coordinators, through the server). Default: an empty list.
--   attempt_details                 one typed answer per attempt and question, with a copy of the
--                                   question text as it was asked (so later edits never change old
--                                   answers). Locked once the attempt is completed.
--
-- RLS: answers are read by super admins and counsellors only (can_view_reports()), like attempt_answers.
-- All writes go through the server (service role).
-- ==============================================================================================

BEGIN;

-- 1. THE LIST, PER QUESTIONNAIRE
ALTER TABLE public.questionnaires
  ADD COLUMN client_details jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(client_details) = 'array');
COMMENT ON COLUMN public.questionnaires.client_details IS
  'Client-details questions asked after the safety questions: [{id, text {en, hi}}]. Edited at any time; not versioned';

-- 2. THE ANSWERS
CREATE TABLE public.attempt_details (
  attempt_id uuid NOT NULL REFERENCES public.attempts(id),
  detail_id text NOT NULL CHECK (detail_id ~ '^[A-Za-z][A-Za-z0-9_]*$'),
  question jsonb NOT NULL CHECK (jsonb_typeof(question) = 'object'),
  answer text NOT NULL CHECK (length(btrim(answer)) BETWEEN 1 AND 2000),
  sort integer NOT NULL DEFAULT 0,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, detail_id)
);
COMMENT ON TABLE public.attempt_details IS
  'Typed client-details answers, with the question as it was asked; care team only (can_view_reports())';

-- Same lock as attempt_answers: nothing changes once the attempt is completed.
CREATE TRIGGER trg_attempt_details_guard BEFORE INSERT OR UPDATE OR DELETE ON public.attempt_details
  FOR EACH ROW EXECUTE FUNCTION public.attempt_answer_guard();

ALTER TABLE public.attempt_details ENABLE ROW LEVEL SECURITY;
CREATE POLICY attempt_details_select ON public.attempt_details FOR SELECT USING (public.can_view_reports());

COMMIT;

-- ==============================================================================================
-- Counsellor's conclusion — free text written by the care team after going through an assessment.
-- Additive: adds one table, one guard function and its triggers. Deletes nothing, drops nothing,
-- changes no existing row. Run after 20261103000001_drop_google_drive_connection.sql.
--
--   attempt_conclusions   one conclusion per completed attempt. Written and edited at any time by
--                         super admins and counsellors (through the server, service role). Keeps who
--                         wrote it first and who edited it last (with their name as it was then, since
--                         counsellors cannot read other staff profiles). Never deleted.
--
-- RLS: read by super admins and counsellors only (can_view_reports()), like attempt_answers.
-- Never in the report, the PDF or any notification. Coordinators and clients never see it.
-- ==============================================================================================

BEGIN;

CREATE TABLE public.attempt_conclusions (
  attempt_id uuid PRIMARY KEY REFERENCES public.attempts(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.profiles(id),
  updated_by_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.attempt_conclusions IS
  'Counsellor''s conclusion per completed attempt; care team only (can_view_reports()); never in the report or PDF';

CREATE TRIGGER trg_attempt_conclusions_updated_at BEFORE UPDATE ON public.attempt_conclusions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Only on a completed attempt; never deleted; who wrote it first and when never change.
CREATE OR REPLACE FUNCTION public.attempt_conclusion_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Conclusions are never deleted.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.attempts a WHERE a.id = NEW.attempt_id AND a.status = 'completed') THEN
      RAISE EXCEPTION 'A conclusion can only be written for a completed assessment.' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'The assessment and first author of a conclusion never change.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attempt_conclusions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.attempt_conclusions
  FOR EACH ROW EXECUTE FUNCTION public.attempt_conclusion_guard();

ALTER TABLE public.attempt_conclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY attempt_conclusions_select ON public.attempt_conclusions FOR SELECT USING (public.can_view_reports());

COMMIT;

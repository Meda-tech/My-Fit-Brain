-- "Mark as call done": new choices for every call (owner, 2026-11-23). Run after 20261123300000_purchase_finished.sql.
--
-- REMOVES NOTHING. No DELETE, no DROP of data, no TRUNCATE. Two CHECK rules on call_logs are replaced by WIDER ones
-- (owner's standing permission, 2026-11-20): choice + 'talked'; the follow-up rule also covers 'talked'. No row is
-- changed: open calls stay open, call history stays as it is (old Done / Call later / Client agreed lines keep showing).
-- New body for call_mark().
--
-- In plain words, for Payment, Assessment, Booking and Package calls alike:
--   * Choices: Talked to client (talked) · Not picked / Call later (not_picked) · Not interested.
--     Talked and Not picked need a follow-up date and time within 2 working days; the call stays open with that due
--     time. Not interested only after at least 2 calls, with a reason. A note on every choice.
--   * "Done" and "Client agreed – will pay" are gone (and Call later is now part of Not picked). A call closes only by
--     itself when the client does the step (paid · assessment completed · presentation booked · package paid), or when
--     the coordinator marks Not interested. (Refunded / cancelled and the go-live rules close calls as before.)
--
-- Checks: docs/tasks/36-call-choices-verify.sql · behaviour test supabase/staging/staging-test-call-choices.sql

BEGIN;

ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_choice_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_choice_check
  CHECK (choice IN ('done', 'call_later', 'not_picked', 'not_interested', 'agreed', 'talked'));
ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_follow_up;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_follow_up
  CHECK ((choice IN ('call_later', 'not_picked', 'agreed', 'talked')) = (follow_up_at IS NOT NULL));
COMMENT ON COLUMN public.call_logs.choice IS 'Mark as call done. Since 2026-11-23: talked (Talked to client), not_picked (Not picked / Call later), not_interested. Older rows may hold done, call_later or agreed (Client agreed – will pay).';

CREATE OR REPLACE FUNCTION public.call_mark(p_call uuid, p_by uuid, p_choice text, p_reason text, p_note text, p_follow_up timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.calls;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := p_reason;
  v_follow_up timestamptz := p_follow_up;
BEGIN
  SELECT * INTO c FROM public.calls WHERE id = p_call FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This call was not found.';
  END IF;
  IF c.status <> 'open' THEN
    RAISE EXCEPTION 'This call is already closed.';
  END IF;
  IF p_choice IS NULL OR p_choice NOT IN ('talked', 'not_picked', 'not_interested') THEN
    RAISE EXCEPTION 'Choose what happened on the call.';
  END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'The note is too long (2,000 characters at most).';
  END IF;

  IF p_choice IN ('talked', 'not_picked') THEN
    IF v_follow_up IS NULL OR v_follow_up <= now() OR v_follow_up > public.add_working_hours(now(), 18) THEN
      RAISE EXCEPTION 'Pick a follow-up date and time within 2 working days.';
    END IF;
  ELSE
    v_follow_up := NULL;
  END IF;

  IF p_choice = 'not_interested' THEN
    IF (SELECT count(*) FROM public.call_logs WHERE call_id = c.id AND entry = 'call') < 2 THEN
      RAISE EXCEPTION 'At least 2 calls are needed first.';
    END IF;
    IF v_reason IS NULL OR v_reason NOT IN ('too_costly', 'not_now', 'wrong_number', 'other') THEN
      RAISE EXCEPTION 'Choose a reason.';
    END IF;
  ELSE
    v_reason := NULL;
  END IF;

  INSERT INTO public.call_logs (call_id, entry, choice, reason, note, follow_up_at, by_profile_id, by_name)
  VALUES (c.id, 'call', p_choice, v_reason, v_note, v_follow_up, p_by,
          (SELECT full_name FROM public.profiles WHERE id = p_by));

  IF p_choice IN ('talked', 'not_picked') THEN
    UPDATE public.calls SET due_at = v_follow_up WHERE id = c.id;
  ELSE
    UPDATE public.calls SET status = 'closed', outcome = 'not_interested', closed_at = now() WHERE id = c.id;
    IF c.kind = 'payment' THEN
      UPDATE public.purchases SET closed_at = now(), closed_reason = 'not_interested'
      WHERE id = c.purchase_id AND status = 'not_paid' AND closed_at IS NULL;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) TO service_role;

COMMIT;

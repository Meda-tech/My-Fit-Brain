-- Payment calls for unpaid tries in the 7 days before go-live start at go-live too (owner, 2026-11-21), like the
-- Assessment and Booking calls: due 2 working hours after go-live, so none is late at go-live.
-- Run after 20261121900000_old_purchases_bookable.sql.
--
-- REMOVES NOTHING. No row is deleted; call history is never changed.
-- * New trigger calls_start_at_go_live: a call never starts before go-live (call_settings.go_live_at). A call that
--   would start earlier starts at go-live and is due 2 working hours later. (Today only Payment calls can: the
--   Assessment and Booking calls already start at go-live; tries more than 7 days before go-live get no call at all.)
-- * Open Payment calls made before go-live that nobody has worked yet (no call attempt logged) get the same start and
--   due time now. Calls already worked keep their times, as the go-live rule did for Assessment calls.
--
-- Checks: docs/tasks/33-payment-calls-go-live-verify.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.calls_start_at_go_live_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_go timestamptz := (SELECT go_live_at FROM public.call_settings);
BEGIN
  IF v_go IS NOT NULL AND NEW.created_at < v_go THEN
    NEW.created_at := v_go;
    NEW.due_at := public.add_working_hours(v_go, 2);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER calls_start_at_go_live BEFORE INSERT ON public.calls
  FOR EACH ROW EXECUTE FUNCTION public.calls_start_at_go_live_trigger();

UPDATE public.calls c
SET created_at = g.go_live_at, due_at = public.add_working_hours(g.go_live_at, 2)
FROM public.call_settings g
WHERE c.kind = 'payment' AND c.status = 'open' AND c.created_at < g.go_live_at
  AND NOT EXISTS (SELECT 1 FROM public.call_logs l WHERE l.call_id = c.id AND l.entry = 'call');

REVOKE ALL ON FUNCTION public.calls_start_at_go_live_trigger() FROM PUBLIC, anon, authenticated;

COMMIT;

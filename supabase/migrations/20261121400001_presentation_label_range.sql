-- A presentation slot is shown as its whole time range: "Sun 22 Nov 2026, 9:00–9:30 pm" (owner, 2026-11-21).
-- Run after 20261121400000_presentation_label_12h.sql.
--
-- REMOVES NOTHING. Only the body of presentation_label() changes: the label written into the call history when a
-- presentation is booked or cancelled now shows the slot's start and end ("…, 11:30 am–12:00 pm" across noon). The
-- end is the start plus the slot length in availability_settings (every slot, default or custom, is one slot long).
-- History lines already written are never changed.
--
-- Checks: docs/tasks/28-presentation-label-verify.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.presentation_label(p_date date, p_start time)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  WITH s AS (
    SELECT p_start AS a,
           p_start + make_interval(mins => coalesce((SELECT slot_minutes FROM public.availability_settings LIMIT 1), 30)) AS b
  )
  SELECT to_char(p_date, 'Dy FMDD Mon YYYY') || ', '
      || CASE WHEN to_char(s.a, 'am') = to_char(s.b, 'am') THEN to_char(s.a, 'FMHH12:MI') ELSE to_char(s.a, 'FMHH12:MI am') END
      || '–' || to_char(s.b, 'FMHH12:MI am')
  FROM s;
$$;

COMMIT;

-- Times in 12-hour form everywhere (owner, 2026-11-21: "no 24 hour format anywhere").
-- Run after 20261121300000_packages.sql.
--
-- REMOVES NOTHING. Only the body of presentation_label() changes: the label written into the call history when a
-- presentation is booked or cancelled now reads "Mon 23 Nov 2026, 2:00 pm" (was "…, 14:00"). History lines already
-- written are never changed; the admin shows them in 12-hour form.
--
-- Checks: docs/tasks/28-presentation-label-verify.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.presentation_label(p_date date, p_start time)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(p_date, 'Dy FMDD Mon YYYY') || ', ' || to_char(p_start, 'FMHH12:MI am');
$$;

COMMIT;

-- ==============================================================================
-- Under-18 record (minimal).
--
-- When someone enters an age under 18 at registration, the app still stops them (AGE_STOP screen) and
-- creates no client record. From now on it keeps a minimal record so the team knows who came and can
-- refund any payment: the verified mobile number, the name typed, the age entered, and when. Nothing
-- else from the form is saved (owner decision 2026-10-31).
--
-- This file only ADDS. It deletes, drops or truncates nothing. It does:
--   1. age_stops   one row per mobile number (a second stop updates name, age and last_at)
--   2. RLS         super admins and coordinators read (can_view_payments()); writes only by the server
--
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/16-age-stops-verify.sql.
-- ==============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.age_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  full_name text CHECK (full_name IS NULL OR char_length(full_name) BETWEEN 1 AND 200),
  age integer NOT NULL CHECK (age BETWEEN 1 AND 17),
  auth_user_id uuid,
  first_at timestamptz NOT NULL DEFAULT now(),
  last_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.age_stops IS
  'Under-18 stops at registration: number, name, age entered, when. Minimal record for refunds; no other details.';

ALTER TABLE public.age_stops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS age_stops_select ON public.age_stops;
CREATE POLICY age_stops_select ON public.age_stops FOR SELECT TO authenticated USING (public.can_view_payments());

COMMIT;

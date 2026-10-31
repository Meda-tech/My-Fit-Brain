-- ==============================================================================
-- Link purchases to clients who were already registered with that number.
--
-- Until now a purchase made on the pay link stayed "Not logged in yet" until the client opened Home, even
-- when the number already belonged to a registered client. From now on the app links it when the order
-- is created. This file does the same once for the purchases made before.
--
-- This file deletes, drops or truncates nothing. It only FILLS the empty client_id / claimed_at of
-- purchases that are not started, not marked for refund, and whose number belongs to a client who has
-- signed in before (auth_user_id set). No row is removed; no other column changes.
--
-- Paste-ready: run in the Supabase SQL Editor. Checks: docs/tasks/15-link-registered-purchases-verify.sql.
-- ==============================================================================

BEGIN;

UPDATE public.payments p
SET client_id = c.id,
    claimed_at = now()
FROM public.clients c
WHERE p.client_id IS NULL
  AND p.attempt_id IS NULL
  AND p.refund_status IS NULL
  AND c.auth_user_id IS NOT NULL
  AND c.phone IN (p.phone, substr(p.phone, 2), right(p.phone, 10));

COMMIT;

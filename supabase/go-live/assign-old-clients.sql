-- ONE-TIME GO-LIVE STEP (owner, 2026-11-21). Paste into the production SQL Editor ONCE, after every file of
-- "To paste later, in order" (the last one is 20261121800000_admin_presentation_done.sql, which adds the function).
--
-- REMOVES NOTHING. In plain words:
--   * All existing clients (every phone with a client record, a purchase or a try) get the only active coordinator,
--     with all their purchases and tries.
--   * All existing clients with a paid assessment are assigned to the only active counsellor, so the counsellor keeps
--     seeing their reports. Super admins see everyone, as before.
--   * It STOPS with a message and changes nothing unless there is exactly one active coordinator and exactly one
--     active counsellor at this moment. Then: make the others inactive (or active) in Admin → Team and paste again.
--
-- The result line shows who got the clients and how many. Not a migration: it is not run on staging by
-- staging-migrate.ps1 (staging has two coordinators and two counsellors, so it stops there, as it must).
-- Checks afterwards: docs/tasks/32-admin-presentation-verify.sql

BEGIN;

SELECT public.go_live_assign_old_clients() AS result;

COMMIT;

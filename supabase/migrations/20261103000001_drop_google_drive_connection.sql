-- ==============================================================================
-- THIS FILE DROPS A TABLE. Owner permission given for this one step only (2026-11-03): proof uploads
-- moved from OAuth to a Google service account, so the OAuth token table is no longer used.
--
-- Drops exactly:
--   public.google_drive_connection             the table (made by 20261103000000_offline_payments.sql)
--   trg_google_drive_connection_updated_at     its trigger (goes with the table)
--
-- What the table can hold: at most ONE row, the OAuth connection (Google account email, an ENCRYPTED
-- refresh token, the folder ID). No client, payment, proof or assessment data is in it. No other table
-- refers to it.
--
-- Nothing else is touched: payments, the offline payment columns and rules, the guard and every
-- other table stay exactly as they are. Safe to run whether or not the table exists (IF EXISTS).
-- Run AFTER 20261103000000_offline_payments.sql. Checks: docs/tasks/18-offline-payments-verify.sql.
-- ==============================================================================

BEGIN;

DROP TABLE IF EXISTS public.google_drive_connection;

COMMIT;

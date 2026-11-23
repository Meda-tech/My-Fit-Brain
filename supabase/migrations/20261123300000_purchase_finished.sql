-- A purchase is FINISHED when any of its calls is closed as Not interested (owner, 2026-11-23).
-- Run after 20261123000000_repeat_payments.sql.
--
-- REMOVES NOTHING. No DELETE, no DROP, no TRUNCATE, no allowed-values list changed. One function gets a new body:
-- purchase_is_open().
--
-- In plain words: an "open purchase" (the latest purchase of a phone and assessment, Paid, journey still running) is
-- now also finished when its Assessment, Booking or Package call is closed as Not interested (before: only the Package
-- call). A new try or payment from that number then starts a new purchase with a normal journey. Nothing else
-- changes: the finished purchase, its other calls and its package offer stay as they are.
--
-- (Replaces 20261123100000_close_purchase.sql and 20261123200000_package_after_close.sql, which were only ever on
-- staging and were removed, owner decision 2026-11-23.)
--
-- Checks: docs/tasks/35-purchase-finished-verify.sql · behaviour test supabase/staging/staging-test-purchase-finished.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.purchase_is_open(p public.purchases)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id IS NOT NULL AND p.kind = 'assessment' AND p.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = p.id AND x.kind = 'package' AND x.status = 'paid')
    AND NOT EXISTS (SELECT 1 FROM public.calls c
                    WHERE c.purchase_id = p.id AND c.kind IN ('assessment', 'booking', 'package')
                      AND c.status = 'closed' AND c.outcome = 'not_interested');
$$;
COMMENT ON FUNCTION public.purchase_is_open(public.purchases) IS 'Open purchase: Paid assessment purchase, no package paid for it, no Assessment / Booking / Package call closed as Not interested. Refunded and cancelled purchases have another status.';

REVOKE ALL ON FUNCTION public.purchase_is_open(public.purchases) FROM PUBLIC, anon, authenticated;

COMMIT;

-- STAGING ONLY. Behaviour test for repeat tries and payments (same phone + same assessment, owner 2026-11-23).
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-repeat-payments.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin;

-- A Razorpay try of a phone, made p_minutes ago (times are explicit: inside one transaction now() never moves).
CREATE FUNCTION pg_temp.try(p_id uuid, p_phone text, p_minutes int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.payments (id, phone, test_code, amount_paise, currency, provider_order_id, created_at)
  VALUES (p_id, p_phone, 'IA', 350000, 'INR', 'order_rp_' || p_id, now() - make_interval(mins => p_minutes));
$$;
CREATE FUNCTION pg_temp.pay(p_id uuid, p_minutes int) RETURNS void LANGUAGE sql AS $$
  UPDATE public.payments SET status = 'paid', provider_payment_id = 'pay_rp_' || p_id, method = 'upi',
         paid_at = now() - make_interval(mins => p_minutes)
  WHERE id = p_id;
$$;
CREATE FUNCTION pg_temp.manual(p_id uuid, p_phone text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, currency, status, provider_order_id, provider_payment_id,
                               paid_at, method, reference, recorded_by, proof_file_id, proof_url)
  SELECT p_id, p_phone, 'IA', 'offline', 350000, 'INR', 'paid', 'offline_' || p_id, 'offline_' || p_id, now(), 'upi',
         'UPI-REPEAT-' || left(p_id::text, 8), admin, 'fake-proof', 'https://drive.example/fake-proof' FROM t;
$$;
CREATE FUNCTION pg_temp.row_of(p_id uuid) RETURNS uuid LANGUAGE sql AS $$
  SELECT purchase_id FROM public.purchase_payments WHERE payment_id = p_id;
$$;
CREATE FUNCTION pg_temp.rows_of(p_phone text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.purchases WHERE phone = p_phone AND kind = 'assessment';
$$;

-- 0. These test numbers are unused on staging.
SELECT 'test numbers unused', NOT EXISTS (SELECT 1 FROM public.payments WHERE phone LIKE '+9199999005__');

-- 1. Latest row is an unpaid try: tries and a payment join that same row; paid → that row is Paid.
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050201', '+919999900502', 30);
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050202', '+919999900502', 20);
SELECT pg_temp.manual('5eed0000-0000-4000-8000-000000050203', '+919999900502');
SELECT '1. two tries and a manual payment: one row, Paid, by the manual payment',
  pg_temp.rows_of('+919999900502') = 1
  AND pg_temp.row_of('5eed0000-0000-4000-8000-000000050201') = pg_temp.row_of('5eed0000-0000-4000-8000-000000050203')
  AND (SELECT status = 'paid' FROM public.purchases WHERE id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050203'))
  AND (SELECT refund_status IS NULL FROM public.payments WHERE id = '5eed0000-0000-4000-8000-000000050203');

-- 2. Latest row is an OPEN purchase.
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050101', '+919999900501', 60);
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050101', 50);
CREATE TEMP TABLE z ON COMMIT DROP AS SELECT pg_temp.row_of('5eed0000-0000-4000-8000-000000050101') AS z;
SELECT '2a. the open purchase is found (manual form and pay page ask this)',
  (SELECT purchase_id = (SELECT z FROM z) FROM public.purchase_open_for('+919999900501', 'IA'));
-- (Its own statement: a row written by a function is seen only by the next statement.)
CREATE TEMP TABLE b ON COMMIT DROP AS SELECT public.pay_page_try_blocked('+919999900501', 'IA', false, 'test-ip-hash') AS blocked;
SELECT '2b. pay page: blocked, one history line on the open purchase, no new row, no call',
  (SELECT blocked FROM b)
  AND (SELECT count(*) = 1 FROM public.purchase_blocked_tries WHERE purchase_id = (SELECT z FROM z) AND NOT signed_in)
  AND pg_temp.rows_of('+919999900501') = 1
  AND NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT z FROM z) AND kind = 'payment' AND status = 'open');
SELECT '2c. a phone with nothing open is not blocked and nothing is written',
  NOT public.pay_page_try_blocked('+919999900599', 'IA', false, 'test-ip-hash')
  AND NOT EXISTS (SELECT 1 FROM public.purchase_blocked_tries WHERE phone = '+919999900599');

-- Safety net: an order that slipped through (two tabs) joins the open purchase as history and starts nothing.
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050102', '+919999900501', 10);
SELECT '2d. a try that slipped through: history on the open purchase, no new row, no Payment call',
  pg_temp.row_of('5eed0000-0000-4000-8000-000000050102') = (SELECT z FROM z)
  AND pg_temp.rows_of('+919999900501') = 1
  AND NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT z FROM z) AND kind = 'payment' AND status = 'open');
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050102', 5);
SELECT '2e. it gets paid anyway: kept, Refund needed, on the open purchase; the purchase keeps its first payment; one journey',
  (SELECT refund_status = 'needed' FROM public.payments WHERE id = '5eed0000-0000-4000-8000-000000050102')
  AND (SELECT extra_paid_at IS NOT NULL AND purchase_id = (SELECT z FROM z) FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000050102')
  AND (SELECT status = 'paid' AND paid_at = now() - interval '50 minutes' FROM public.purchases WHERE id = (SELECT z FROM z))
  AND pg_temp.rows_of('+919999900501') = 1
  AND (SELECT count(*) = 1 FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
       WHERE pu.phone = '+919999900501' AND c.kind = 'assessment');
SELECT pg_temp.manual('5eed0000-0000-4000-8000-000000050103', '+919999900501');
SELECT '2f. a manual payment that slipped through: the same (kept, Refund needed, no new row)',
  (SELECT refund_status = 'needed' FROM public.payments WHERE id = '5eed0000-0000-4000-8000-000000050103')
  AND (SELECT extra_paid_at IS NOT NULL AND purchase_id = (SELECT z FROM z) FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000050103')
  AND pg_temp.rows_of('+919999900501') = 1
  AND (SELECT paid_at = now() - interval '50 minutes' FROM public.purchases WHERE id = (SELECT z FROM z));
-- Moved to another number (Payments → Move): in use again, its own row and journey.
UPDATE public.payments SET phone = '+919999900509', client_id = NULL, claimed_at = NULL, refund_status = NULL
WHERE id = '5eed0000-0000-4000-8000-000000050102';
SELECT '2g. an extra payment moved to another number gets its own Paid row; the open purchase is unchanged',
  pg_temp.row_of('5eed0000-0000-4000-8000-000000050102') <> (SELECT z FROM z)
  AND (SELECT status = 'paid' AND phone = '+919999900509' FROM public.purchases WHERE id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050102'))
  AND (SELECT extra_paid_at IS NULL FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000050102')
  AND (SELECT status = 'paid' AND paid_at = now() - interval '50 minutes' FROM public.purchases WHERE id = (SELECT z FROM z));

-- Two tabs, both orders made while the row was still unpaid: the second payment is the extra one.
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050501', '+919999900505', 10);
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050502', '+919999900505', 9);
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050501', 8);
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050502', 7);
SELECT '2h. two tabs: one Paid purchase by the first payment; the second is Refund needed, no second journey',
  pg_temp.rows_of('+919999900505') = 1
  AND (SELECT paid_at = now() - interval '8 minutes' FROM public.purchases WHERE id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050501'))
  AND (SELECT refund_status IS NULL FROM public.payments WHERE id = '5eed0000-0000-4000-8000-000000050501')
  AND (SELECT refund_status = 'needed' FROM public.payments WHERE id = '5eed0000-0000-4000-8000-000000050502')
  AND (SELECT count(*) = 1 FROM public.calls c WHERE c.purchase_id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050501') AND c.kind = 'assessment');

-- 3. Latest row is FINISHED: retakes work.
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050301', '+919999900503', 120);
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050301', 110);
UPDATE public.payments SET refund_status = 'refunded' WHERE id = '5eed0000-0000-4000-8000-000000050301';
SELECT '3a. refunded: nothing open, the pay page is not blocked',
  NOT EXISTS (SELECT 1 FROM public.purchase_open_for('+919999900503', 'IA'))
  AND NOT public.pay_page_try_blocked('+919999900503', 'IA', true, null);
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050302', '+919999900503', 5);
UPDATE public.payments SET status = 'failed' WHERE id = '5eed0000-0000-4000-8000-000000050302';
SELECT '3b. a new try after a finished purchase: a new row with a normal Payment call',
  pg_temp.rows_of('+919999900503') = 2
  AND (SELECT status = 'not_paid' FROM public.purchases WHERE id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050302'))
  AND EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050302') AND kind = 'payment' AND status = 'open');
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050303', '+919999900503', 3);
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050303', 2);
SELECT '3c. its payment joins that row: a new Paid purchase with its own journey (Assessment call)',
  pg_temp.rows_of('+919999900503') = 2
  AND pg_temp.row_of('5eed0000-0000-4000-8000-000000050303') = pg_temp.row_of('5eed0000-0000-4000-8000-000000050302')
  AND (SELECT status = 'paid' FROM public.purchases WHERE id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050303'))
  AND (SELECT refund_status IS NULL FROM public.payments WHERE id = '5eed0000-0000-4000-8000-000000050303')
  AND EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050303') AND kind = 'assessment')
  AND (SELECT kind = 'payment' AND status = 'closed' AND outcome = 'paid' FROM public.calls
       WHERE purchase_id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050303') AND kind = 'payment');

SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050401', '+919999900504', 120);
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050401', 110);
INSERT INTO public.calls (purchase_id, kind, status, outcome, created_at, due_at, closed_at)
VALUES (pg_temp.row_of('5eed0000-0000-4000-8000-000000050401'), 'package', 'closed', 'not_interested', now(), now(), now());
SELECT '3d. Package call closed as Not interested: finished; a new try starts a new row',
  NOT EXISTS (SELECT 1 FROM public.purchase_open_for('+919999900504', 'IA'));
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050402', '+919999900504', 5);
SELECT '3e. ... a new row, not the finished purchase',
  pg_temp.rows_of('+919999900504') = 2
  AND pg_temp.row_of('5eed0000-0000-4000-8000-000000050402') <> pg_temp.row_of('5eed0000-0000-4000-8000-000000050401');

-- 4. Not needed: an extra unpaid row closes with its open Payment call ("Not needed – client already paid on <date>").
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050601', '+919999900506', 10);
UPDATE public.payments SET status = 'failed' WHERE id = '5eed0000-0000-4000-8000-000000050601';
SELECT public.purchase_close_not_needed(pg_temp.row_of('5eed0000-0000-4000-8000-000000050601'), timestamptz '2026-11-17 14:49+05:30');
SELECT '4a. the row closes as not needed and is hidden; its Payment call closes with the note and a history line',
  (SELECT closed_reason = 'not_needed' AND closed_at IS NOT NULL FROM public.purchases WHERE id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050601'))
  AND (SELECT status = 'closed' AND outcome = 'not_needed' AND closed_note = 'Not needed – client already paid on 17 Nov 2026.'
       FROM public.calls WHERE purchase_id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050601') AND kind = 'payment')
  AND EXISTS (SELECT 1 FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
              WHERE c.purchase_id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050601') AND l.event = 'not_needed');
SELECT public.calls_sync() >= 0 AS synced;
SELECT '4b. a closed "not needed" call never reopens, and the row is no longer the latest',
  (SELECT status = 'closed' FROM public.calls WHERE purchase_id = pg_temp.row_of('5eed0000-0000-4000-8000-000000050601') AND kind = 'payment')
  AND (SELECT id IS NULL FROM public.purchase_latest('+919999900506', 'IA'));

-- 6. The one-time fix (same loop as section 6 of the migration), on the situation it was made for: a client paid
-- (17 Nov), later tried again and that try became its own unpaid row with an open Payment call (before this change).
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050701', '+919999900507', 600);
SELECT pg_temp.pay('5eed0000-0000-4000-8000-000000050701', 590);
SELECT pg_temp.try('5eed0000-0000-4000-8000-000000050702', '+919999900507', 40);
CREATE TEMP TABLE old ON COMMIT DROP AS
SELECT pg_temp.row_of('5eed0000-0000-4000-8000-000000050701') AS open_id,
       public.purchase_new('5eed0000-0000-4000-8000-000000050702') AS extra_id;
UPDATE public.purchase_payments SET purchase_id = (SELECT extra_id FROM old) WHERE payment_id = '5eed0000-0000-4000-8000-000000050702';
SELECT public.purchase_refresh((SELECT extra_id FROM old)), public.calls_sync_purchase((SELECT extra_id FROM old));
SELECT '6a. before the fix: the extra unpaid row has an open Payment call (what the team saw)',
  EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT extra_id FROM old) AND kind = 'payment' AND status = 'open');
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT x.id AS extra_id, zp.id AS open_id, zp.paid_at
    FROM public.purchases x
    CROSS JOIN LATERAL (
      SELECT z.id FROM public.purchases z
      WHERE z.phone = x.phone AND z.test_code = x.test_code AND z.kind = 'assessment' AND z.status = 'paid'
        AND z.created_at < x.created_at AND z.paid_at < x.created_at
      ORDER BY z.created_at DESC, z.id DESC
      LIMIT 1
    ) z
    JOIN public.purchases zp ON zp.id = z.id
    WHERE x.kind = 'assessment' AND x.status = 'not_paid'
      AND (x.closed_at IS NULL OR x.closed_reason = 'not_interested')
      AND public.purchase_is_open(zp)
    ORDER BY x.created_at
  LOOP
    UPDATE public.purchase_payments SET purchase_id = r.open_id, linked_at = now() WHERE purchase_id = r.extra_id;
    PERFORM public.purchase_close_not_needed(r.extra_id, r.paid_at);
    PERFORM public.purchase_refresh(r.open_id);
  END LOOP;
END;
$$;
SELECT '6b. after the fix: the try is history on the paid purchase; the extra row and its Payment call are closed as not needed',
  pg_temp.row_of('5eed0000-0000-4000-8000-000000050702') = (SELECT open_id FROM old)
  AND (SELECT status = 'paid' AND paid_at = now() - interval '590 minutes' FROM public.purchases WHERE id = (SELECT open_id FROM old))
  AND (SELECT closed_reason = 'not_needed' FROM public.purchases WHERE id = (SELECT extra_id FROM old))
  AND (SELECT status = 'closed' AND outcome = 'not_needed' AND closed_note LIKE 'Not needed – client already paid on %'
       FROM public.calls WHERE purchase_id = (SELECT extra_id FROM old) AND kind = 'payment');

-- 5. Blocked tries are never changed or removed.
SELECT '5. blocked tries are kept',
  (SELECT count(*) FROM public.purchase_blocked_tries WHERE purchase_id = (SELECT z FROM z)) = 1;

ROLLBACK;

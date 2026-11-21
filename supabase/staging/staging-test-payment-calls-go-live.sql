-- STAGING ONLY. Behaviour test for 20261122000000_payment_calls_go_live.sql.
-- One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-payment-calls-go-live.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE TEMP TABLE t ON COMMIT DROP AS SELECT (SELECT go_live_at FROM public.call_settings) AS go;

-- Three unpaid tries (Razorpay checkout not completed): 3 days before go-live, 6 days before, and 1 hour ago.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, created_at)
SELECT v.id, v.phone, 'IA', 'razorpay', 350000, 'created', 'order_pcg_test_' || v.n, v.at
FROM t, LATERAL (VALUES
  ('5eed0000-0000-4000-8000-000000110001'::uuid, '+919999900111', 1, t.go - interval '3 days'),
  ('5eed0000-0000-4000-8000-000000110002'::uuid, '+919999900112', 2, t.go - interval '6 days'),
  ('5eed0000-0000-4000-8000-000000110003'::uuid, '+919999900113', 3, now() - interval '1 hour')
) AS v(id, phone, n, at);
CREATE TEMP TABLE t_p ON COMMIT DROP AS
SELECT (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000110001') AS p3,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000110002') AS p6,
       (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000110003') AS pnew;
SELECT public.calls_sync() >= 0 AS synced;

SELECT 'tries in the 7 days before go-live: their Payment calls start at go-live, due 2 working hours after it',
  (SELECT count(*) = 2 AND bool_and(c.created_at = t.go AND c.due_at = public.add_working_hours(t.go, 2) AND c.status = 'open')
   FROM public.calls c, t WHERE c.kind = 'payment' AND c.purchase_id IN ((SELECT p3 FROM t_p), (SELECT p6 FROM t_p)));
SELECT 'a try after go-live: its Payment call starts 30 minutes after the try, as before',
  (SELECT c.created_at = p.created_at + interval '30 minutes' AND c.due_at = public.add_working_hours(c.created_at, 2)
   FROM public.calls c JOIN public.purchase_payments pp ON pp.purchase_id = c.purchase_id JOIN public.payments p ON p.id = pp.payment_id
   WHERE c.kind = 'payment' AND c.purchase_id = (SELECT pnew FROM t_p));
-- A try 10 days before go-live (before the system).
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, created_at)
SELECT '5eed0000-0000-4000-8000-000000110004', '+919999900114', 'IA', 'razorpay', 350000, 'created', 'order_pcg_test_4', go - interval '10 days' FROM t;
SELECT public.calls_sync() >= 0 AS synced_again;
SELECT 'a try more than 7 days before go-live still gets no call at all',
  (SELECT public.before_system(pu) FROM public.purchases pu
   WHERE pu.id = (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000110004'))
  AND NOT EXISTS (SELECT 1 FROM public.calls
                  WHERE purchase_id = (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-000000110004'));

ROLLBACK;

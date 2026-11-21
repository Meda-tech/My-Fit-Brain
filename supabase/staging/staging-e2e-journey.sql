-- STAGING ONLY. One full end-to-end journey (owner request, step 5):
-- failed try → paid → assessment completed → booked → presentation done → Package call (Client agreed – will pay) → package paid.
-- Real functions and triggers, one transaction, ROLLED BACK at the end: nothing is kept.
-- (Inside one transaction the clock does not move: every "actual" time is the same moment; the planned times show
-- the working-hours rules from that moment.)
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-e2e-journey.sql

\set ON_ERROR_STOP on
\pset format aligned
\pset tuples_only off
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE TEMP TABLE e2e ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin;

-- 1. A try on the pay page fails → payment attempt (Unpaid) + Payment call at once.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-00000e2e0001', '+919999900051', 'IA', 'razorpay', 350000, 'failed', 'order_E2E_FAILED');
ALTER TABLE e2e ADD COLUMN purchase uuid, ADD COLUMN coordinator uuid;
UPDATE e2e SET purchase = (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = '5eed0000-0000-4000-8000-00000e2e0001');
UPDATE e2e SET coordinator = (SELECT coordinator_id FROM public.purchases WHERE id = e2e.purchase);

-- 2. The coordinator calls: Not picked, follow-up in an hour.
SELECT public.call_mark((SELECT id FROM public.calls WHERE purchase_id = (SELECT purchase FROM e2e) AND kind = 'payment'),
                        (SELECT coordinator FROM e2e), 'not_picked', null, 'E2E: no answer', now() + interval '1 hour')::text = '' AS step2;

-- 3. The client tries again and pays (Razorpay) → the attempt becomes the Paid purchase.
INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id)
VALUES ('5eed0000-0000-4000-8000-00000e2e0002', '+919999900051', 'IA', 'razorpay', 350000, 'created', 'order_E2E_PAID');
UPDATE public.payments SET status = 'paid', provider_payment_id = 'pay_E2E_PAID', paid_at = now(), method = 'upi'
WHERE id = '5eed0000-0000-4000-8000-00000e2e0002';

-- 4. The client logs in, registers, starts and completes the assessment.
INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
VALUES ('5eed0000-0000-4000-8000-00000e2e00c1', '+919999900051', 'E2E Journey', 'Female', 29, 'Married');
UPDATE public.payments SET client_id = '5eed0000-0000-4000-8000-00000e2e00c1', claimed_at = now() WHERE phone = '+919999900051';
SELECT public.create_paid_attempt('5eed0000-0000-4000-8000-00000e2e00c1', 'IA',
  (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), 'pay_E2E_PAID', now(), 'en') IS NOT NULL AS step4;
UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = 'pay_E2E_PAID')
WHERE id = '5eed0000-0000-4000-8000-00000e2e0002';
UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = 'pay_E2E_PAID';
UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = 'pay_E2E_PAID';

-- 5. The coordinator books the first free slot (Book presentation).
SELECT public.presentation_book((SELECT purchase FROM e2e), f.counsellor_id, f.on_date, f.start_time, (SELECT coordinator FROM e2e)) IS NOT NULL AS step5
FROM public.free_presentation_slots(current_date, current_date + 29) f
ORDER BY f.on_date, f.start_time LIMIT 1;

-- 6. Report presentation done (a super admin here: the slot is in the future; a counsellor waits for the slot).
SELECT public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = (SELECT purchase FROM e2e) AND status = 'booked'),
                                     (SELECT admin FROM e2e))::text = '' AS step6;

-- 7. Package call: "Client agreed – will pay" (step 6: the call stays open with a follow-up).
SELECT public.call_mark((SELECT id FROM public.calls WHERE purchase_id = (SELECT purchase FROM e2e) AND kind = 'package'),
                        (SELECT coordinator FROM e2e), 'agreed', null, 'E2E: agreed, will pay', now() + interval '1 hour')::text = '' AS step7;

-- 8. The client pays the package in the app (Razorpay): the order, then the confirmed payment.
SELECT public.package_payment_start('5eed0000-0000-4000-8000-00000e2e0a01', (SELECT purchase FROM e2e), '5eed0000-0000-4000-8000-00000e2e00c1',
                                    'order_E2E_PACKAGE', (SELECT amount_paise FROM public.package_offer((SELECT purchase FROM e2e))))::text = '' AS step8a;
SELECT public.package_payment_mark_paid('5eed0000-0000-4000-8000-00000e2e0a01', 'pay_E2E_PACKAGE', 'upi', now()) AS step8b;

-- The result.
\echo
\echo '== Package =='
SELECT x.kind, x.status, x.amount_paise / 100 AS rupees, x.source, pp.package_name, pp.sessions, pp.price_paise / 100 AS price, pp.advance_paise / 100 AS advance
FROM public.purchases x JOIN public.package_payments pp ON pp.package_purchase_id = x.id
WHERE x.parent_purchase_id = (SELECT purchase FROM e2e);

\echo '== Purchase =='
SELECT pu.status, pu.test_code, pu.phone, c.full_name AS client, pr.full_name AS coordinator,
       (SELECT count(*) FROM public.purchase_payments pp WHERE pp.purchase_id = pu.id) AS payments_in_it
FROM public.purchases pu
LEFT JOIN public.clients c ON c.id = pu.client_id
LEFT JOIN public.profiles pr ON pr.id = pu.coordinator_id
WHERE pu.id = (SELECT purchase FROM e2e);

\echo '== Purchase journey (India time) =='
SELECT s.position AS "#", s.stage,
       to_char(s.planned_at AT TIME ZONE 'Asia/Kolkata', 'Dy DD Mon YYYY HH24:MI') AS planned,
       to_char(s.done_at AT TIME ZONE 'Asia/Kolkata', 'Dy DD Mon YYYY HH24:MI:SS') AS actual,
       s.status
FROM public.purchase_stages s WHERE s.purchase_id = (SELECT purchase FROM e2e) ORDER BY s.position;

\echo '== Calls (India time) =='
SELECT c.kind, c.status, c.outcome,
       to_char(c.created_at AT TIME ZONE 'Asia/Kolkata', 'Dy DD Mon HH24:MI') AS started,
       to_char(c.due_at AT TIME ZONE 'Asia/Kolkata', 'Dy DD Mon HH24:MI') AS due,
       to_char(c.closed_at AT TIME ZONE 'Asia/Kolkata', 'Dy DD Mon HH24:MI') AS closed
FROM public.calls c WHERE c.purchase_id = (SELECT purchase FROM e2e)
ORDER BY array_position(ARRAY['payment', 'assessment', 'booking', 'package'], c.kind);

\echo '== Call history =='
SELECT c.kind, coalesce(l.choice, l.event) AS line, l.note, l.by_name
FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
WHERE c.purchase_id = (SELECT purchase FROM e2e)
ORDER BY array_position(ARRAY['payment', 'assessment', 'booking', 'package'], c.kind), l.at, l.id;

\echo '== Presentation =='
SELECT pr.full_name AS counsellor, public.presentation_label(b.on_date, b.start_time) AS slot, b.booked_by_name,
       b.done_by_name, b.status
FROM public.presentation_bookings b JOIN public.profiles pr ON pr.id = b.counsellor_id
WHERE b.purchase_id = (SELECT purchase FROM e2e);

\echo '== Now (India time) =='
SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata', 'Dy DD Mon YYYY HH24:MI:SS') AS now;

ROLLBACK;

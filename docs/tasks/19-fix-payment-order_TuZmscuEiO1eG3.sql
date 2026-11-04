-- ==============================================================================
-- PRODUCTION one-time fix (owner pastes it in the production SQL Editor). Deletes nothing.
-- ==============================================================================
-- Purchase 0f563590-e8cf-4d93-905d-263276acd3fb (order_TuZmscuEiO1eG3, +919991212442, IA) was paid and
-- captured in Razorpay (pay_TuZnFMXYkpo4Gm, UPI, 31 Oct 2026 9:40 pm IST), but neither the browser nor the
-- webhook confirmed it here, so it stayed "created" and was never linked to the client.
-- This marks that one row paid with the Razorpay payment ID and links it to the client registered with
-- that number (if any). Only that row, and only while it is still "created" — running it twice does nothing.
-- Check in Razorpay first that the payment amount is ₹3,500.
-- ==============================================================================

BEGIN;

UPDATE public.payments p
SET status              = 'paid',
    provider_payment_id = 'pay_TuZnFMXYkpo4Gm',
    method              = 'upi',
    paid_at             = '2026-10-31 21:40:00+05:30',
    client_id           = c.id,
    claimed_at          = CASE WHEN c.id IS NULL THEN NULL ELSE now() END
FROM (SELECT (SELECT id FROM public.clients WHERE phone = '+919991212442') AS id) c
WHERE p.id = '0f563590-e8cf-4d93-905d-263276acd3fb'
  AND p.provider_order_id = 'order_TuZmscuEiO1eG3'
  AND p.status = 'created'
  AND p.amount_paise = 350000;

COMMIT;

-- Check (select only): status should be paid, client_id filled, attempt_id empty (he can press Start).
SELECT p.status, p.provider_payment_id, p.paid_at, p.client_id, p.claimed_at, p.attempt_id, c.full_name
FROM public.payments p
LEFT JOIN public.clients c ON c.id = p.client_id
WHERE p.id = '0f563590-e8cf-4d93-905d-263276acd3fb';

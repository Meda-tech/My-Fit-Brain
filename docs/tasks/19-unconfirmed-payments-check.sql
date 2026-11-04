-- PRODUCTION check, select only. Razorpay purchases still "not completed" (status created) older than
-- one hour. Look up each order ID in the Razorpay dashboard (Transactions → Orders): if Razorpay shows it
-- paid/captured, it was missed like order_TuZmscuEiO1eG3 and needs the same fix.

SELECT p.created_at AT TIME ZONE 'Asia/Kolkata' AS started_ist,
       p.provider_order_id,
       p.phone,
       p.test_code,
       c.full_name AS registered_client
FROM public.payments p
LEFT JOIN public.clients c ON c.phone = p.phone
WHERE p.provider = 'razorpay'
  AND p.status = 'created'
  AND p.created_at < now() - interval '1 hour'
ORDER BY p.created_at;

-- Webhook deliveries that reached us (0 rows = the Razorpay webhook has never worked on production).
SELECT count(*) AS webhook_events, max(received_at) AS last_event FROM public.payment_events;

-- Verification for supabase/migrations/20261020000000_payments.sql (read-only).

-- 1. Tables exist with RLS on.
select relname, relrowsecurity from pg_class
where relname in ('payments', 'payment_events') and relnamespace = 'public'::regnamespace order by relname;

-- 2. Policies.
select tablename, policyname, cmd, qual from pg_policies
where schemaname = 'public' and tablename in ('payments', 'payment_events') order by tablename;

-- 3. Guards and the one-attempt-per-payment index.
select tgname from pg_trigger where tgrelid = 'public.payments'::regclass and not tgisinternal order by tgname;
-- Expect trg_payments_guard, trg_payments_updated_at.
select indexname, indexdef from pg_indexes where indexname = 'uq_attempts_live_payment_ref';

-- 4. After a test payment: the payment, its attempt and the report ID.
select p.status, p.amount_paise, p.provider_order_id, p.provider_payment_id, p.method, p.paid_at,
       a.report_id, a.status as attempt_status, a.payment_mode
from public.payments p left join public.attempts a on a.id = p.attempt_id
order by p.created_at desc limit 5;

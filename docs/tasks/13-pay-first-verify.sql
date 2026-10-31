-- Checks for 20261031000000_pay_first.sql. SELECT only: run in the Supabase SQL Editor after the migration.

-- 1. Pay links that work: /pay/<code> for every questionnaire with a live version (expect IA and MA once
--    published).
select q.code, q.name_en, '/pay/' || q.code as pay_link
from public.questionnaires q
where exists (select 1 from public.questionnaire_versions v where v.questionnaire_code = q.code and v.status = 'live')
order by q.sort;

-- 2. New payment columns exist (expect 4 rows).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'payments'
  and column_name in ('phone', 'claimed_at', 'refund_status', 'ip_hash')
order by column_name;

-- 3. client_id may now be empty (expect is_nullable = YES).
select is_nullable from information_schema.columns
where table_schema = 'public' and table_name = 'payments' and column_name = 'client_id';

-- 4. Existing payments got a phone and count as claimed (expect 0).
select count(*) as payments_without_phone_or_claim
from public.payments where phone is null or (client_id is not null and claimed_at is null);

-- 5. Constraints in place (expect 4 rows).
select conname from pg_constraint
where conrelid = 'public.payments'::regclass
  and conname in ('payments_phone_e164', 'payments_refund_status', 'payments_claimed', 'payments_attempt_has_client')
order by conname;

-- 6. payment_moves has RLS on and one select policy (expect rowsecurity = true, 1 policy).
select relname, relrowsecurity from pg_class where oid = 'public.payment_moves'::regclass;
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'payment_moves';

-- 7. Paid purchases not started yet, by phone (what Admin → Payments → "Paid, not started" shows).
select phone, test_code, paid_at, client_id is not null as claimed, refund_status
from public.payments
where status = 'paid' and attempt_id is null
order by paid_at desc;

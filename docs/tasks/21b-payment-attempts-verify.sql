-- Checks for supabase/migrations/20261120110000_payment_attempts.sql. SELECT only, changes nothing.
-- Run docs/tasks/21-purchases-verify.sql too. Every row: ok = true.

select 'purchases has closed_at; the payment_attempts view reads with the caller''s rights' as check,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchases' and column_name = 'closed_at')
  and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname = 'payment_attempts' and c.relkind = 'v'
                and 'security_invoker=true' = any (c.reloptions)) as ok
union all
select 'coordinator_client_moves: RLS on, one read rule for super admins',
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'coordinator_client_moves')
  and (select count(*) = 1 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename = 'coordinator_client_moves')
union all
select 'triggers in place: payments → purchases, attempts → purchases, profiles keep clients',
  (select count(*) = 3 from pg_trigger where not tgisinternal
     and tgname in ('payments_purchase', 'attempts_purchase', 'profiles_keep_clients'))
union all
select 'at most one open payment attempt per phone and assessment',
  not exists (select 1 from public.purchases where status = 'not_paid' and closed_at is null
              group by phone, test_code having count(*) > 1)
union all
select 'an open attempt is the newest row of its phone and assessment',
  not exists (select 1 from public.purchases a join public.purchases l
                on l.phone = a.phone and l.test_code = a.test_code and l.kind = 'assessment' and (l.created_at, l.id) > (a.created_at, a.id)
              where a.status = 'not_paid' and a.closed_at is null)
union all
select 'one paid payment per purchase',
  not exists (select 1 from public.purchase_payments pp join public.payments p on p.id = pp.payment_id
              where p.status = 'paid' group by pp.purchase_id having count(*) > 1)
union all
select 'payment_attempts shows exactly the not-paid rows',
  (select count(*) from public.payment_attempts) = (select count(*) from public.purchases where status = 'not_paid')
union all
select 'no inactive coordinator still has clients',
  not exists (select 1 from public.client_coordinators c join public.profiles p on p.id = c.coordinator_id
              where not p.is_active)
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.move_coordinator_clients(uuid, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.move_coordinator_clients(uuid, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.purchase_new(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.purchase_one_paid(uuid)', 'EXECUTE')
  and not has_table_privilege('anon', 'public.payment_attempts', 'SELECT');

-- For reading: purchases (shown on the Purchases screen) and payment attempts (not shown), and clients per coordinator.
select case when status = 'not_paid' then 'payment attempt (' || case when closed_at is null then 'open' else 'closed' end || ')'
            else 'purchase: ' || status end as kind, count(*)
from public.purchases group by 1 order by 1;
select coalesce(p.full_name, '(no coordinator)') as coordinator, p.is_active, count(*) as clients
from public.client_coordinators c left join public.profiles p on p.id = c.coordinator_id group by 1, 2 order by 1;

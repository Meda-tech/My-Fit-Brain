-- Checks for supabase/migrations/20261120100000_purchases.sql. SELECT only, changes nothing.
-- Every row: ok = true.

select 'new tables exist, each with RLS on (5)' as check, count(*) = 5 as ok from pg_tables
  where schemaname = 'public' and rowsecurity
    and tablename in ('coordinator_round_robin', 'client_coordinators', 'purchases', 'purchase_payments', 'purchase_stages')
union all
select 'each new table has one read rule and no write rule', count(*) = 5 and bool_and(cmd = 'SELECT') from pg_policies
  where schemaname = 'public'
    and tablename in ('coordinator_round_robin', 'client_coordinators', 'purchases', 'purchase_payments', 'purchase_stages')
union all
select 'the payments table has no new column',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments'
              and column_name in ('purchase_id', 'accounts_check'))
union all
select 'every payment belongs to one purchase',
  not exists (select 1 from public.payments p where not exists (select 1 from public.purchase_payments pp where pp.payment_id = p.id))
union all
select 'every purchase has its five journey stages, in order',
  not exists (select 1 from public.purchases pu
              where (select count(*) from public.purchase_stages s where s.purchase_id = pu.id) <> 5)
  and not exists (select 1 from public.purchase_stages
                  where (stage, position) not in (('payment', 1), ('assessment', 2), ('presentation_booking', 3),
                                                  ('report_presentation', 4), ('package_call', 5)))
union all
select 'a paid purchase has a paid payment; a not-paid purchase has none',
  not exists (select 1 from public.purchases pu where pu.status in ('paid', 'refunded') and not exists (
                select 1 from public.purchase_payments pp join public.payments p on p.id = pp.payment_id
                where pp.purchase_id = pu.id and p.status = 'paid'))
  and not exists (select 1 from public.purchases pu where pu.status = 'not_paid' and exists (
                select 1 from public.purchase_payments pp join public.payments p on p.id = pp.payment_id
                where pp.purchase_id = pu.id and p.status = 'paid'))
union all
select 'Payment stage actual time = paid at',
  not exists (select 1 from public.purchases pu join public.purchase_stages s on s.purchase_id = pu.id and s.stage = 'payment'
              where s.done_at is distinct from pu.paid_at)
union all
select 'Assessment stage actual time = assessment completed at',
  not exists (select 1 from public.purchase_stages s
              join public.purchase_payments pp on pp.purchase_id = s.purchase_id
              join public.payments p on p.id = pp.payment_id and p.status = 'paid'
              join public.attempts a on a.id = p.attempt_id
              where s.stage = 'assessment' and s.done_at is distinct from (case when a.status = 'completed' then a.completed_at end))
union all
select 'one open stage at most per purchase, and done means it has an actual time',
  not exists (select 1 from public.purchase_stages where status = 'open' group by purchase_id having count(*) > 1)
  and not exists (select 1 from public.purchase_stages where (status = 'done') <> (done_at is not null))
union all
select 'manual payments carry "Accounts check: pending" (or checked); others none',
  not exists (select 1 from public.purchase_payments pp join public.payments p on p.id = pp.payment_id
              where (p.provider = 'offline') <> (pp.accounts_check is not null))
union all
select 'one coordinator per phone: every purchase shows its client''s coordinator',
  not exists (select 1 from public.purchases pu left join public.client_coordinators c on c.phone = pu.phone
              where c.phone is null or pu.coordinator_id is distinct from c.coordinator_id)
union all
select 'working hours: Fri 17:30 + 2 h = Sat 10:30',
  public.add_working_hours('2026-11-20 17:30+05:30', 2) = '2026-11-21 10:30+05:30'
union all
select 'working hours: Sat 17:00 + 2 h = Mon 10:00 (Sunday off)',
  public.add_working_hours('2026-11-21 17:00+05:30', 2) = '2026-11-23 10:00+05:30'
union all
select 'working hours: before opening and on Sunday count from 9:00',
  public.add_working_hours('2026-11-23 07:00+05:30', 2) = '2026-11-23 11:00+05:30'
  and public.add_working_hours('2026-11-22 11:00+05:30', 1) = '2026-11-23 10:00+05:30'
union all
select 'working hours: 9 h = one full day (Mon 9:00 → Tue 9:00)',
  public.add_working_hours('2026-11-23 09:00+05:30', 9) = '2026-11-23 18:00+05:30'
  and public.add_working_hours('2026-11-23 09:00+05:30', 10) = '2026-11-24 10:00+05:30'
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.purchase_for_payment(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.purchase_for_payment(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.client_coordinator(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.purchase_refresh(uuid)', 'EXECUTE');

-- For reading: purchases by status, and by coordinator.
select status, count(*) from public.purchases group by status order by status;
select coalesce(pr.full_name, '(no coordinator)') as coordinator, count(*) as purchases
from public.purchases pu left join public.profiles pr on pr.id = pu.coordinator_id group by 1 order by 1;

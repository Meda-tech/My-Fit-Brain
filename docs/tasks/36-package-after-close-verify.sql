-- Checks for supabase/migrations/20261123200000_package_after_close.sql. SELECT only, changes nothing.
-- Every row: ok = true. The last query lists the tasks in words (no ok column).

select 'wider allowed values: call kind package_inform' as check,
  pg_get_constraintdef((select oid from pg_constraint where conname = 'calls_kind_check')) like '%package_inform%' as ok;

select 'trigger purchases_package_after_close exists' as check,
  exists (select 1 from pg_trigger where tgname = 'purchases_package_after_close' and not tgisinternal) as ok;

select 'every "Package paid – inform the team" task sits on a closed purchase that has a paid package' as check,
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where c.kind = 'package_inform'
                and (pu.closed_reason is distinct from 'closed_by_staff'
                     or not exists (select 1 from public.purchases x where x.parent_purchase_id = pu.id and x.kind = 'package' and x.status = 'paid'))) as ok;

select 'a "Package paid – inform the team" task was only ever closed with Done' as check,
  not exists (select 1 from public.calls where kind = 'package_inform' and status = 'closed' and outcome <> 'done')
  and not exists (select 1 from public.call_logs l join public.calls c on c.id = l.call_id
                  where c.kind = 'package_inform' and l.entry = 'call' and l.choice <> 'done') as ok;

-- In words.
select pu.phone, pu.test_code, pu.closed_at, c.created_at as package_paid_at, c.status, c.due_at
from public.calls c join public.purchases pu on pu.id = c.purchase_id
where c.kind = 'package_inform' order by c.created_at desc;

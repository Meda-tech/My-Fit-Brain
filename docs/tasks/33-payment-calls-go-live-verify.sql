-- Checks for supabase/migrations/20261122000000_payment_calls_go_live.sql. SELECT only, changes nothing.
-- Every row: ok = true. The last query lists open calls in words (no ok column).

select 'no call starts before go-live (trigger calls_start_at_go_live)' as check,
  exists (select 1 from pg_trigger where tgname = 'calls_start_at_go_live' and not tgisinternal) as ok;

select 'no open Payment call that nobody worked starts before go-live or is due before 2 working hours after it' as check,
  not exists (select 1 from public.calls c, public.call_settings g
              where c.kind = 'payment' and c.status = 'open'
                and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.entry = 'call')
                and (c.created_at < g.go_live_at or c.due_at < public.add_working_hours(g.go_live_at, 2))) as ok;

select 'nothing that nobody worked is late before 2 working hours after go-live' as check,
  not exists (select 1 from public.calls c, public.call_settings g
              where c.status = 'open'
                and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.entry = 'call')
                and c.due_at < public.add_working_hours(g.go_live_at, 2)) as ok;

-- In words.
select 'open calls: ' || kind as what, count(*) as n, count(*) filter (where due_at < now()) as late_now
from public.calls where status = 'open' group by kind order by kind;

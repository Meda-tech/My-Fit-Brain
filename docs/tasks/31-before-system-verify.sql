-- Checks for supabase/migrations/20261121700000_before_system.sql. SELECT only, changes nothing.
-- Every row: ok = true. The last query lists the counts in words (no ok column).
-- Checks for 20261121700000, 20261121700001 and 20261121900000. The behaviour (no automatic call, booking by hand)
-- is tried in supabase/staging/staging-test-before-system.sql.

select 'no open Payment, Assessment or Booking call on a purchase from before the system (never due or late)' as check,
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where c.status = 'open' and c.kind <> 'package' and public.before_system(pu)) as ok;

select 'automatic calls for them can no longer be made (trigger); they can be booked into a slot by hand (20261121900000)' as check,
  exists (select 1 from pg_trigger where tgname = 'calls_before_system' and not tgisinternal)
  and position('This purchase is from before the system.' in
      pg_get_functiondef('public.presentation_book(uuid, uuid, date, time, uuid)'::regprocedure)) = 0 as ok;

-- In words.
select 'before the system: purchases and tries' as what, count(*) as n
from public.purchases pu where pu.kind = 'assessment' and public.before_system(pu)
union all
select 'of those, with an open Payment, Assessment or Booking call', count(distinct c.purchase_id)
from public.calls c join public.purchases pu on pu.id = c.purchase_id where c.status = 'open' and c.kind <> 'package' and public.before_system(pu)
union all
select 'of those, with a presentation (booked by hand, or marked by an admin)', count(distinct b.purchase_id)
from public.presentation_bookings b join public.purchases pu on pu.id = b.purchase_id where public.before_system(pu)
union all
select 'after go-live (the flow runs): purchases and tries', count(*)
from public.purchases pu where pu.kind = 'assessment' and not public.before_system(pu);

-- 20261121700001_before_system_planned.sql
select 'before the system: no step that is not done has a planned time' as check,
  not exists (select 1 from public.purchase_stages s join public.purchases pu on pu.id = s.purchase_id
              where s.done_at is null and s.planned_at is not null and public.before_system(pu)) as ok;

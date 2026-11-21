-- Checks for supabase/migrations/20261121200000_presentation_done.sql. SELECT only, changes nothing.
-- Every row: ok = true.

select 'a presentation marked done has who and when, and is still booked (never cancelled after)' as check,
  not exists (select 1 from public.presentation_bookings where done_at is not null and (status <> 'booked' or done_by_name is null)) as ok
union all
select 'marked done: journey Report presentation actual = marked time',
  not exists (select 1 from public.presentation_bookings b
              join public.purchase_stages s on s.purchase_id = b.purchase_id and s.stage = 'report_presentation'
              where b.done_at is not null and s.done_at is distinct from b.done_at)
union all
select 'marked done: one Package call, starting at the marked time, first due 2 working hours later = journey Package call planned',
  not exists (select 1 from public.presentation_bookings b
              join public.purchase_stages s on s.purchase_id = b.purchase_id and s.stage = 'package_call'
              left join public.calls c on c.purchase_id = b.purchase_id and c.kind = 'package'
              where b.done_at is not null
                and (c.id is null or c.created_at <> b.done_at or s.planned_at is distinct from public.add_working_hours(b.done_at, 2)))
union all
select 'a Package call exists only after the presentation was marked done',
  not exists (select 1 from public.calls c where c.kind = 'package'
              and not exists (select 1 from public.presentation_bookings b where b.purchase_id = c.purchase_id and b.done_at is not null))
union all
select 'Package call closed as Client agreed (done): journey Package call actual = closed time',
  not exists (select 1 from public.calls c join public.purchase_stages s on s.purchase_id = c.purchase_id and s.stage = 'package_call'
              where c.kind = 'package' and c.outcome = 'done' and s.done_at is distinct from c.closed_at)
union all
select 'the trigger that fills the Package call actual time exists',
  exists (select 1 from pg_trigger where tgname = 'calls_package_journey' and not tgisinternal)
union all
select 'the writing function cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.presentation_mark_done(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.presentation_mark_done(uuid, uuid)', 'EXECUTE');

-- For reading: presentations (booked) marked done or not, and slot time passed but not marked.
select count(*) filter (where done_at is not null) as marked_done,
       count(*) filter (where done_at is null and (on_date + start_time) at time zone 'Asia/Kolkata' < now()) as passed_not_marked,
       count(*) filter (where done_at is null and (on_date + start_time) at time zone 'Asia/Kolkata' >= now()) as upcoming
from public.presentation_bookings where status = 'booked';

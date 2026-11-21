-- Checks for supabase/migrations/20261121100000_presentation_booking.sql. SELECT only, changes nothing.
-- Every row: ok = true.

select 'presentation_bookings exists, RLS on, one read rule, no write rule' as check,
  (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'presentation_bookings')
  and (select count(*) = 1 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename = 'presentation_bookings') as ok
union all
select 'the database refuses a double booking (one active booking per counsellor slot and per purchase)',
  (select count(*) = 2 from pg_indexes where schemaname = 'public'
     and indexname in ('presentation_bookings_slot_uniq', 'presentation_bookings_purchase_uniq'))
  and not exists (select 1 from public.presentation_bookings where status = 'booked' group by counsellor_id, on_date, start_time having count(*) > 1)
  and not exists (select 1 from public.presentation_bookings where status = 'booked' group by purchase_id having count(*) > 1)
union all
select 'bookings are never removed, only cancelled once (trigger); a cancel has who, when and a reason',
  exists (select 1 from pg_trigger where tgname = 'presentation_bookings_keep' and not tgisinternal)
  and not exists (select 1 from public.presentation_bookings
                  where status = 'cancelled' and (cancelled_at is null or cancelled_by_name is null or length(btrim(cancel_reason)) < 3))
union all
select 'every active booking shows as Booked in the availability',
  not exists (select 1 from public.presentation_bookings b
              where b.status = 'booked'
                and not exists (select 1 from public.counsellor_slots(b.counsellor_id, b.on_date, b.on_date) s
                                where s.start_time = b.start_time and s.state = 'booked'))
union all
select 'journey of a booked purchase: Presentation booking done, Report presentation planned = the slot',
  not exists (select 1 from public.presentation_bookings b
              join public.purchase_stages pb on pb.purchase_id = b.purchase_id and pb.stage = 'presentation_booking'
              join public.purchase_stages rp on rp.purchase_id = b.purchase_id and rp.stage = 'report_presentation'
              join public.purchases pu on pu.id = b.purchase_id
              where b.status = 'booked' and not public.before_system(pu)   -- old purchases use no slot and plan nothing
                and (pb.done_at is null or rp.planned_at is distinct from (b.on_date + b.start_time) at time zone 'Asia/Kolkata'))
union all
select 'no open Booking call while a presentation is booked',
  not exists (select 1 from public.calls c join public.presentation_bookings b on b.purchase_id = c.purchase_id and b.status = 'booked'
              where c.kind = 'booking' and c.status = 'open')
union all
select 'completed (at most 7 days before go-live, or later), paid, not booked: it has its Booking call',
  not exists (select 1 from public.purchases pu
              join public.purchase_stages s on s.purchase_id = pu.id and s.stage = 'assessment'
              cross join public.call_settings g
              where pu.status = 'paid' and s.done_at is not null and s.done_at >= g.go_live_at - interval '7 days'
                and not exists (select 1 from public.presentation_bookings b where b.purchase_id = pu.id and b.status = 'booked')
                and not exists (select 1 from public.calls c where c.purchase_id = pu.id and c.kind = 'booking'))
union all
select 'Booking call: starts at the completed time (or go-live), due 2 working hours later (until a follow-up or a cancel)',
  not exists (select 1 from public.calls c
              join public.purchase_stages s on s.purchase_id = c.purchase_id and s.stage = 'assessment'
              cross join public.call_settings g
              where c.kind = 'booking'
                and not exists (select 1 from public.call_logs l where l.call_id = c.id
                                and (l.follow_up_at is not null or l.event = 'booking_cancelled'))
                and (c.created_at <> greatest(s.done_at, g.go_live_at) or c.due_at <> public.add_working_hours(c.created_at, 2)))
union all
select 'journey: Presentation booking planned = the Booking call''s first due time',
  not exists (select 1 from public.calls c
              join public.purchase_stages s on s.purchase_id = c.purchase_id and s.stage = 'presentation_booking'
              join public.purchases pu on pu.id = c.purchase_id
              where c.kind = 'booking' and s.planned_at is distinct from public.add_working_hours(c.created_at, 2)
                and not public.before_system(pu)   -- before the system: no Booking call, nothing planned
                and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.event = 'booking_cancelled'))
union all
select 'a closed-by-booking call has its "Presentation booked" line',
  not exists (select 1 from public.calls c where c.kind = 'booking' and c.outcome = 'booked'
              and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.event = 'presentation_booked'))
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.presentation_book(uuid, uuid, date, time, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.presentation_book(uuid, uuid, date, time, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.presentation_cancel(uuid, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.free_presentation_slots(date, date)', 'EXECUTE');

-- For reading: bookings by status, and open Booking calls.
select status, count(*) from public.presentation_bookings group by status order by status;
select count(*) as open_booking_calls, count(*) filter (where due_at < now()) as late
from public.calls where kind = 'booking' and status = 'open';

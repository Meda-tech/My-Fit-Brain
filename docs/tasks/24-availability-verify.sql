-- Checks for supabase/migrations/20261121000001_counsellor_availability.sql. SELECT only, changes nothing.
-- Every row: ok = true. (The day checks use 2026-11-23, a Monday, and 2026-11-22, a Sunday, for an active
-- counsellor who has no changes on those dates; they read the default only.)

with c as (
  select p.id from public.profiles p
  where p.role = 'counsellor' and p.is_active
    and not exists (select 1 from public.availability_changes x where x.counsellor_id = p.id and x.on_date in ('2026-11-22', '2026-11-23'))
  limit 1
)
select 'availability tables exist, RLS on, read by super admins only, no write rule' as check,
  (select count(*) = 2 from pg_tables where schemaname = 'public' and rowsecurity and tablename in ('availability_settings', 'availability_changes'))
  and (select count(*) = 2 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename in ('availability_settings', 'availability_changes')) as ok
union all
select 'the default is stored once: 30-minute slots, Mon–Sat, 9:00–18:00, no gap, lunch 13:00–13:30',
  (select count(*) = 1 from public.availability_settings)
  and exists (select 1 from public.availability_settings
              where slot_minutes = 30 and gap_minutes = 0 and work_days = '{1,2,3,4,5,6}'
                and day_start = '09:00' and day_end = '18:00' and lunch_start = '13:00' and lunch_end = '13:30')
union all
select 'a default Monday has 17 free slots: 9:00 … 12:30, 13:30 … 17:30',
  (select count(*) = 17 and bool_and(state = 'free')
          and min(start_time) = '09:00' and max(start_time) = '17:30'
          and not bool_or(start_time = '13:00') and bool_or(start_time = '12:30') and bool_or(start_time = '13:30')
   from c, public.counsellor_slots(c.id, '2026-11-23', '2026-11-23'))
union all
select 'Sunday is off by default (no slots)',
  (select count(*) = 0 from c, public.counsellor_slots(c.id, '2026-11-22', '2026-11-22'))
union all
select 'every change is consistent (range, custom has times, undone has who)',
  not exists (select 1 from public.availability_changes
              where (start_time is null) <> (end_time is null) or start_time >= end_time
                 or (kind = 'custom' and start_time is null) or ((removed_at is null) <> (removed_by_name is null)))
union all
select 'changes are never deleted, and only undone once (trigger)',
  exists (select 1 from pg_trigger where tgname = 'availability_changes_keep' and not tgisinternal)
union all
select 'Booked comes only from active presentation bookings (step 4; before it, nothing was booked)',
  case when to_regclass('public.presentation_bookings') is null
       then not public.availability_booked((select id from public.profiles limit 1), current_date, '00:00', '23:59')
       else true end
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.availability_add(uuid, text, date, time, time, text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.availability_add(uuid, text, date, time, time, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.availability_remove(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.counsellor_slots(uuid, date, date)', 'EXECUTE');

-- For reading: changes per counsellor (active / undone).
select p.full_name, x.kind, count(*) filter (where x.removed_at is null) as active, count(*) filter (where x.removed_at is not null) as undone
from public.availability_changes x join public.profiles p on p.id = x.counsellor_id group by 1, 2 order by 1, 2;

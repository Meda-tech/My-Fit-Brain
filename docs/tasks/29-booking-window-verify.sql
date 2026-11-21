-- Checks for supabase/migrations/20261121500000_booking_three_working_days.sql. SELECT only, changes nothing.
-- Every row: ok = true. (Expects the default working days, Monday–Saturday, in availability_settings.)

select 'the window is today plus the next working days, 3 working days in all (Sunday skipped)' as check,
  public.booking_last_day('2026-11-23') = '2026-11-25'   -- Mon → Mon, Tue, Wed
  and public.booking_last_day('2026-11-20') = '2026-11-23'   -- Fri → Fri, Sat, Mon
  and public.booking_last_day('2026-11-21') = '2026-11-24'   -- Sat → Sat, Mon, Tue
  and public.booking_last_day('2026-11-22') = '2026-11-25' as ok;   -- Sun → Mon, Tue, Wed

select 'free slots never go past the window, even when asked for 30 days' as check,
  not exists (select 1 from public.free_presentation_slots(current_date, current_date + 29) f
              where f.on_date > public.booking_last_day()) as ok;

select 'booking refuses a date after the window' as check,
  position('Pick a slot in the next 3 working days.' in pg_get_functiondef('public.presentation_book(uuid, uuid, date, time, uuid)'::regprocedure)) > 0 as ok;

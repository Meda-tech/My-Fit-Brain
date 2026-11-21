-- Checks for supabase/migrations/20261121400000_presentation_label_12h.sql and
-- 20261121400001_presentation_label_range.sql. SELECT only, changes nothing.
-- Every row: ok = true. (Expects the default 30-minute slots in availability_settings.)

select 'booking labels show the whole slot in 12-hour times' as check,
  public.presentation_label('2026-11-23', '14:00') = 'Mon 23 Nov 2026, 2:00–2:30 pm'
  and public.presentation_label('2026-11-23', '09:30') = 'Mon 23 Nov 2026, 9:30–10:00 am'
  and public.presentation_label('2026-11-23', '11:30') = 'Mon 23 Nov 2026, 11:30 am–12:00 pm'
  and public.presentation_label('2026-11-23', '12:00') = 'Mon 23 Nov 2026, 12:00–12:30 pm'
  and public.presentation_label('2026-11-23', '21:00') = 'Mon 23 Nov 2026, 9:00–9:30 pm' as ok;

-- Checks for supabase/migrations/20261123100000_close_purchase.sql. SELECT only, changes nothing.
-- Every row: ok = true. The last query lists closed purchases in words (no ok column).

select 'wider allowed values: closed_by_staff, purchase_closed (call outcome and call event)' as check,
  pg_get_constraintdef((select oid from pg_constraint where conname = 'purchases_closed_reason_check')) like '%closed_by_staff%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'calls_outcome_check')) like '%purchase_closed%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'call_logs_event_check')) like '%purchase_closed%' as ok;

select 'new columns closed_by, closed_by_name, close_note and the rule purchases_closed_by_staff' as check,
  (select count(*) = 3 from information_schema.columns
   where table_schema = 'public' and table_name = 'purchases' and column_name in ('closed_by', 'closed_by_name', 'close_note'))
  and exists (select 1 from pg_constraint where conname = 'purchases_closed_by_staff') as ok;

select 'purchase_close() exists; only the server may call it' as check,
  exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'purchase_close')
  and not has_function_privilege('anon', 'public.purchase_close(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.purchase_close(uuid, text, uuid)', 'execute') as ok;

select 'guards: no new call and no new booking for a closed purchase' as check,
  exists (select 1 from pg_trigger where tgname = 'calls_not_for_closed_purchase' and not tgisinternal)
  and exists (select 1 from pg_trigger where tgname = 'presentation_bookings_not_for_closed_purchase' and not tgisinternal) as ok;

select 'no closed purchase has an open call' as check,
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where pu.closed_reason = 'closed_by_staff' and c.status = 'open') as ok;

select 'no purchase is open while one of its calls is closed as Not interested' as check,
  not exists (select 1 from public.purchases pu join public.calls c on c.purchase_id = pu.id
              where c.kind in ('assessment', 'booking', 'package') and c.status = 'closed' and c.outcome = 'not_interested'
                and public.purchase_is_open(pu)) as ok;

-- In words: closed purchases.
select pu.phone, pu.test_code, pu.paid_at, pu.closed_at, pu.closed_by_name, pu.close_note
from public.purchases pu where pu.closed_reason = 'closed_by_staff' order by pu.closed_at desc;

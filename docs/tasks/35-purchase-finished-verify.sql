-- Checks for supabase/migrations/20261123300000_purchase_finished.sql. SELECT only, changes nothing.
-- Every row: ok = true.

select 'purchase_is_open() counts Not interested on the Assessment, Booking and Package call' as check,
  pg_get_functiondef('public.purchase_is_open(public.purchases)'::regprocedure) like '%''assessment'', ''booking'', ''package''%'
  and pg_get_functiondef('public.purchase_is_open(public.purchases)'::regprocedure) like '%not_interested%' as ok;

select 'the browser roles cannot call it' as check,
  not has_function_privilege('anon', 'public.purchase_is_open(public.purchases)', 'execute')
  and not has_function_privilege('authenticated', 'public.purchase_is_open(public.purchases)', 'execute') as ok;

select 'no purchase is open while one of its calls is closed as Not interested' as check,
  not exists (select 1 from public.purchases pu join public.calls c on c.purchase_id = pu.id
              where c.kind in ('assessment', 'booking', 'package') and c.status = 'closed' and c.outcome = 'not_interested'
                and public.purchase_is_open(pu)) as ok;

select 'nothing from the removed Close purchase / inform task is left (function, triggers)' as check,
  not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
              and proname in ('purchase_close', 'calls_not_for_closed_purchase_trigger', 'bookings_not_for_closed_purchase_trigger',
                              'purchases_package_after_close_trigger')) as ok;

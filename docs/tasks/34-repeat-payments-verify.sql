-- Checks for supabase/migrations/20261123000000_repeat_payments.sql. SELECT only, changes nothing.
-- Every row: ok = true. The last two queries list rows in words (no ok column).

select 'wider allowed values: closed_reason, call outcome and call event accept not_needed' as check,
  pg_get_constraintdef((select oid from pg_constraint where conname = 'purchases_closed_reason_check')) like '%not_needed%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'calls_outcome_check')) like '%not_needed%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'call_logs_event_check')) like '%not_needed%' as ok;

select 'new column purchase_payments.extra_paid_at and table purchase_blocked_tries (RLS on, keep trigger)' as check,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchase_payments' and column_name = 'extra_paid_at')
  and (select relrowsecurity from pg_class where oid = 'public.purchase_blocked_tries'::regclass)
  and exists (select 1 from pg_trigger where tgname = 'purchase_blocked_tries_keep' and not tgisinternal) as ok;

select 'functions present: purchase_latest, purchase_is_open, purchase_open_for, pay_page_try_blocked, purchase_extra_paid, purchase_extra_moved, purchase_close_not_needed' as check,
  (select count(distinct proname) = 7 from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('purchase_latest', 'purchase_is_open', 'purchase_open_for', 'pay_page_try_blocked',
                     'purchase_extra_paid', 'purchase_extra_moved', 'purchase_close_not_needed')) as ok;

select 'the browser roles cannot call the new functions' as check,
  not has_function_privilege('anon', 'public.pay_page_try_blocked(text, text, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.pay_page_try_blocked(text, text, boolean, text)', 'execute')
  and not has_function_privilege('anon', 'public.purchase_open_for(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.purchase_open_for(text, text)', 'execute') as ok;

select 'no unpaid row is still shown while the same phone had an open purchase before its first try (one-time fix)' as check,
  not exists (
    select 1 from public.purchases x
    join lateral (select z.id from public.purchases z
                  where z.phone = x.phone and z.test_code = x.test_code and z.kind = 'assessment' and z.status = 'paid'
                    and z.created_at < x.created_at and z.paid_at < x.created_at
                  order by z.created_at desc, z.id desc limit 1) z on true
    join public.purchases zp on zp.id = z.id
    where x.kind = 'assessment' and x.status = 'not_paid'
      and (x.closed_at is null or x.closed_reason = 'not_interested')
      and public.purchase_is_open(zp)) as ok;

select 'no open call on a row closed as not needed' as check,
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where pu.closed_reason = 'not_needed' and c.status = 'open') as ok;

select 'every extra (safety net) payment is paid, marked for refund (or refunded) and sits on a paid purchase' as check,
  not exists (select 1 from public.purchase_payments pp
              join public.payments p on p.id = pp.payment_id
              join public.purchases pu on pu.id = pp.purchase_id
              where pp.extra_paid_at is not null
                and (p.status <> 'paid' or p.refund_status is null or pu.status = 'not_paid')) as ok;

select 'no purchase speaks with an extra payment: each Paid purchase keeps a paid payment that is not extra' as check,
  not exists (select 1 from public.purchases pu
              where pu.kind = 'assessment' and pu.status in ('paid', 'refunded')
                and not exists (select 1 from public.purchase_payments pp join public.payments p on p.id = pp.payment_id
                                where pp.purchase_id = pu.id and p.status = 'paid' and pp.extra_paid_at is null)) as ok;

-- In words: rows closed as not needed (the one-time fix, e.g. a try after paying), with their open purchase.
select x.phone, x.test_code, x.created_at as extra_row_first_try, x.closed_at, c.closed_note
from public.purchases x
left join public.calls c on c.purchase_id = x.id and c.kind = 'payment'
where x.closed_reason = 'not_needed'
order by x.created_at;

-- In words: open purchases now (phone and assessment), with blocked tries and extra payments.
select pu.phone, pu.test_code, pu.paid_at,
       (select count(*) from public.purchase_blocked_tries b where b.purchase_id = pu.id) as blocked_tries,
       (select count(*) from public.purchase_payments pp where pp.purchase_id = pu.id and pp.extra_paid_at is not null) as extra_payments
from public.purchases pu
where pu.kind = 'assessment' and public.purchase_is_open(pu)
  and (exists (select 1 from public.purchase_blocked_tries b where b.purchase_id = pu.id)
       or exists (select 1 from public.purchase_payments pp where pp.purchase_id = pu.id and pp.extra_paid_at is not null))
order by pu.paid_at desc;

-- Checks for 20261125000000_package_pending_payment_call.sql (Pending payment call after a package part payment; the
-- start amount in at most 2 payments). SELECT only: reads, never changes anything. Every row must say t.

select 'calls.kind allows pending_payment (and keeps the four older kinds)',
  pg_get_constraintdef(oid) like '%payment%' and pg_get_constraintdef(oid) like '%assessment%' and pg_get_constraintdef(oid) like '%booking%'
  and pg_get_constraintdef(oid) like '%''package''%' and pg_get_constraintdef(oid) like '%pending_payment%'
from pg_constraint where conname = 'calls_kind_check';

select 'calls.outcome allows part_paid (and keeps package_started, not_needed, not_interested)',
  pg_get_constraintdef(oid) like '%part_paid%' and pg_get_constraintdef(oid) like '%package_started%'
  and pg_get_constraintdef(oid) like '%not_needed%' and pg_get_constraintdef(oid) like '%not_interested%'
from pg_constraint where conname = 'calls_outcome_check';

select 'package_payments has follow_up_at',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'package_payments' and column_name = 'follow_up_at');

select 'pending_follow_up_last = 27 working hours: Wed 11:00 → Sat 11:00, Thu 11:00 → Mon 11:00 (Sunday off)',
  public.pending_follow_up_last('2026-11-25 11:00+05:30') = '2026-11-28 11:00+05:30'
  and public.pending_follow_up_last('2026-11-26 11:00+05:30') = '2026-11-30 11:00+05:30';

select 'package_payment_add with a follow-up (11 arguments) and the older call (10 arguments) both exist, server only',
  (select count(*) = 2 from pg_proc where proname = 'package_payment_add' and pronamespace = 'public'::regnamespace)
  and has_function_privilege('service_role', 'public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text, timestamptz)', 'execute');

select 'package_payment_add: the follow-up rule and the second-payment rule are in place',
  pg_get_functiondef('public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text, timestamptz)'::regprocedure)
    like '%Pick when to call the client about the rest: within 3 working days.%'
  and pg_get_functiondef('public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text, timestamptz)'::regprocedure)
    like '%The second payment must be at least%';

select 'call_mark: 3 working days on the Pending payment call, 2 on the others; Not interested for admins once paid',
  pg_get_functiondef('public.call_mark(uuid, uuid, text, text, text, timestamptz)'::regprocedure) like '%within 3 working days.%'
  and pg_get_functiondef('public.call_mark(uuid, uuid, text, text, text, timestamptz)'::regprocedure) like '%within 2 working days.%'
  and pg_get_functiondef('public.call_mark(uuid, uuid, text, text, text, timestamptz)'::regprocedure) like '%c.kind IN (''package'', ''pending_payment'')%';

select 'package_settle closes the Package call as part_paid and makes the Pending payment call; the handover closes it',
  pg_get_functiondef('public.package_settle(uuid)'::regprocedure) like '%part_paid%'
  and pg_get_functiondef('public.package_settle(uuid)'::regprocedure) like '%pending_payment%'
  and pg_get_functiondef('public.package_start_if_due(uuid, timestamptz, uuid, text)'::regprocedure) like '%pending_payment%';

select 'purchase_is_open: a Pending payment call closed as Not interested finishes the purchase',
  pg_get_functiondef('public.purchase_is_open(public.purchases)'::regprocedure) like '%pending_payment%';

select 'every part-paid package (below the start amount, not started) has a Pending payment call, and no open Package call',
  not exists (
    select 1 from public.purchases pu cross join lateral public.package_balance(pu.id) b
    where pu.kind = 'assessment' and not b.started and b.paid_paise > 0 and b.paid_paise < b.start_paise
      and (not exists (select 1 from public.calls c where c.purchase_id = pu.id and c.kind = 'pending_payment')
           or exists (select 1 from public.calls c where c.purchase_id = pu.id and c.kind = 'package' and c.status = 'open')));

select 'a Pending payment call exists only where a package amount was paid',
  not exists (
    select 1 from public.calls c where c.kind = 'pending_payment'
      and not exists (select 1 from public.package_payments pp
                      where pp.purchase_id = c.purchase_id and pp.status = 'paid' and pp.refund_status is null and pp.counted_at is not null));

select 'no package started with more than 2 payments before its start amount was reached',
  not exists (
    select 1 from public.package_payments pp
    join public.purchases k on k.id = pp.package_purchase_id
    where pp.counted_at is not null and pp.counted_at <= k.created_at
    group by pp.purchase_id having count(*) > 2);

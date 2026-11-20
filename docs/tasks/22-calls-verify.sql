-- Checks for supabase/migrations/20261120120000_calls.sql. SELECT only, changes nothing.
-- Every row: ok = true.

select 'calls and call_logs exist, RLS on, one read rule each and no write rule' as check,
  (select count(*) = 2 from pg_tables where schemaname = 'public' and rowsecurity and tablename in ('calls', 'call_logs'))
  and (select count(*) = 2 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename in ('calls', 'call_logs')) as ok
union all
select 'closed attempts say why (replaced / not interested)',
  not exists (select 1 from public.purchases where (closed_at is null) <> (closed_reason is null))
union all
select 'one call of each kind per row at most',
  not exists (select 1 from public.calls group by purchase_id, kind having count(*) > 1)
union all
select 'every open attempt tried 30+ minutes ago, or with a failed try, has its Payment call',
  not exists (select 1 from public.purchases pu
              where pu.status = 'not_paid' and pu.closed_at is null
                and (pu.created_at <= now() - interval '30 minutes'
                     or exists (select 1 from public.purchase_payments pp join public.payments p on p.id = pp.payment_id
                                where pp.purchase_id = pu.id and p.status = 'failed'))
                and not exists (select 1 from public.calls c where c.purchase_id = pu.id and c.kind = 'payment'))
union all
select 'no open Payment call on a purchase that is paid (or refunded / cancelled)',
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where c.kind = 'payment' and c.status = 'open' and pu.status <> 'not_paid')
union all
select 'every paid purchase with the assessment not completed has its Assessment call',
  not exists (select 1 from public.purchases pu join public.purchase_stages s on s.purchase_id = pu.id and s.stage = 'assessment'
              where pu.status = 'paid' and s.done_at is null
                and not exists (select 1 from public.calls c where c.purchase_id = pu.id and c.kind = 'assessment'))
union all
select 'no open Assessment call once the assessment is completed',
  not exists (select 1 from public.calls c join public.purchase_stages s on s.purchase_id = c.purchase_id and s.stage = 'assessment'
              where c.kind = 'assessment' and c.status = 'open' and s.done_at is not null)
union all
select 'Assessment call: starts at the paid time, due 2 working hours later (until a follow-up is set)',
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where c.kind = 'assessment' and (c.created_at <> pu.paid_at
                    or (c.due_at <> public.add_working_hours(c.created_at, 2)
                        and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.follow_up_at is not null))))
union all
select 'Payment call: due 2 working hours after it starts (until a follow-up is set)',
  not exists (select 1 from public.calls c
              where c.kind = 'payment' and c.due_at <> public.add_working_hours(c.created_at, 2)
                and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.follow_up_at is not null))
union all
select 'journey: Assessment planned = the Assessment call''s first due time',
  not exists (select 1 from public.calls c join public.purchase_stages s on s.purchase_id = c.purchase_id and s.stage = 'assessment'
              where c.kind = 'assessment' and s.planned_at is distinct from public.add_working_hours(c.created_at, 2))
union all
select 'every call has its "created" line in the history',
  not exists (select 1 from public.calls c
              where not exists (select 1 from public.call_logs l where l.call_id = c.id and l.event = 'created'))
union all
select 'Not interested only after an earlier call, and it closed the call',
  not exists (select 1 from public.call_logs l join public.calls c on c.id = l.call_id
              where l.choice = 'not_interested'
                and (c.outcome is distinct from 'not_interested'
                     or not exists (select 1 from public.call_logs e where e.call_id = l.call_id and e.entry = 'call' and e.at < l.at)))
union all
select 'call history cannot be changed or removed (trigger)',
  exists (select 1 from pg_trigger where tgname = 'call_logs_keep' and not tgisinternal)
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.call_mark(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.call_mark(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.calls_sync()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.calls_sync_purchase(uuid)', 'EXECUTE');

-- For reading: open calls by kind and coordinator, and how many are late.
select c.kind, coalesce(pr.full_name, '(no coordinator)') as coordinator, count(*) as open_calls,
       count(*) filter (where c.due_at < now()) as late
from public.calls c join public.purchases pu on pu.id = c.purchase_id left join public.profiles pr on pr.id = pu.coordinator_id
where c.status = 'open' group by 1, 2 order by 1, 2;

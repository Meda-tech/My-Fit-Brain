-- Checks for the calls after supabase/migrations/20261120130000_calls_go_live.sql and 20261121000000_calls_cleanup.sql (replaces
-- docs/tasks/22-calls-verify.sql from now on). SELECT only, changes nothing. Every row: ok = true.

select 'calls and call_logs exist, RLS on, one read rule each and no write rule' as check,
  (select count(*) = 2 from pg_tables where schemaname = 'public' and rowsecurity and tablename in ('calls', 'call_logs'))
  and (select count(*) = 2 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename in ('calls', 'call_logs')) as ok
union all
select 'go-live is set once (call_settings, RLS on)',
  (select count(*) = 1 from public.call_settings)
  and (select rowsecurity from pg_tables where schemaname = 'public' and tablename = 'call_settings')
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
select 'a failed try after a Payment call was closed (Done / Not interested) reopened it',
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where c.kind = 'payment' and c.status = 'closed' and c.outcome in ('done', 'not_interested') and pu.status = 'not_paid'
                and exists (select 1 from public.purchase_payments pp join public.payments p on p.id = pp.payment_id
                            where pp.purchase_id = pu.id and p.status = 'failed' and p.created_at > c.closed_at))
union all
select 'no open Payment call on a purchase that is paid (or refunded / cancelled)',
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where c.kind = 'payment' and c.status = 'open' and pu.status <> 'not_paid')
union all
select 'paid at most 7 days before go-live (or later), assessment not completed: it has its Assessment call',
  not exists (select 1 from public.purchases pu join public.purchase_stages s on s.purchase_id = pu.id and s.stage = 'assessment'
              cross join public.call_settings g
              where pu.status = 'paid' and s.done_at is null and pu.paid_at >= g.go_live_at - interval '7 days'
                and not exists (select 1 from public.calls c where c.purchase_id = pu.id and c.kind = 'assessment'))
union all
select 'paid more than 7 days before go-live: no open automatic Assessment call (unless already worked)',
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id cross join public.call_settings g
              where c.kind = 'assessment' and c.status = 'open' and pu.paid_at < g.go_live_at - interval '7 days'
                and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.entry = 'call'))
union all
select 'calls closed by the go-live rule have the outcome before_go_live (and only they)',
  not exists (select 1 from public.calls where (closed_note is not null) <> (outcome is not distinct from 'before_go_live'))
union all
select '"reopened" lines only on Payment calls',
  not exists (select 1 from public.call_logs l join public.calls c on c.id = l.call_id
              where l.event = 'reopened' and c.kind <> 'payment')
union all
select 'no open Assessment call once the assessment is completed',
  not exists (select 1 from public.calls c join public.purchase_stages s on s.purchase_id = c.purchase_id and s.stage = 'assessment'
              where c.kind = 'assessment' and c.status = 'open' and s.done_at is not null)
union all
select 'Assessment call: starts at the paid time (or go-live, if paid before), due 2 working hours later (calls already worked before go-live keep their times)',
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id cross join public.call_settings g
              where c.kind = 'assessment' and c.closed_note is null
                and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.entry = 'call' and l.at < g.go_live_at)
                and (c.created_at <> greatest(pu.paid_at, g.go_live_at)
                     or (c.due_at <> public.add_working_hours(c.created_at, 2)
                         and not exists (select 1 from public.call_logs l where l.call_id = c.id and l.follow_up_at is not null))))
union all
select 'journey: Assessment planned = the Assessment call''s first due time (none when closed by the go-live rule)',
  not exists (select 1 from public.calls c join public.purchase_stages s on s.purchase_id = c.purchase_id and s.stage = 'assessment'
              where c.kind = 'assessment'
                and s.planned_at is distinct from case when c.closed_note is null then public.add_working_hours(c.created_at, 2) end)
union all
select 'Payment call: due 2 working hours after it starts (until a follow-up is set or it reopens)',
  not exists (select 1 from public.calls c
              where c.kind = 'payment' and c.due_at <> public.add_working_hours(c.created_at, 2)
                and not exists (select 1 from public.call_logs l where l.call_id = c.id
                                and (l.follow_up_at is not null or l.event = 'try_failed')))
union all
select 'every call has its "created" line in the history',
  not exists (select 1 from public.calls c
              where not exists (select 1 from public.call_logs l where l.call_id = c.id and l.event = 'created'))
union all
select 'Not interested only after an earlier call',
  not exists (select 1 from public.call_logs l
              where l.choice = 'not_interested'
                and not exists (select 1 from public.call_logs e where e.call_id = l.call_id and e.entry = 'call' and e.at < l.at))
union all
select 'call history cannot be changed or removed (trigger)',
  exists (select 1 from pg_trigger where tgname = 'call_logs_keep' and not tgisinternal)
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.call_mark(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.call_mark(uuid, uuid, text, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.calls_sync()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.calls_sync_purchase(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.purchase_for_payment(uuid)', 'EXECUTE');

-- For reading: go-live, open calls by kind and coordinator (and how many are late), calls closed by the go-live rule.
select go_live_at from public.call_settings;
select c.kind, coalesce(pr.full_name, '(no coordinator)') as coordinator, count(*) as open_calls,
       count(*) filter (where c.due_at < now()) as late
from public.calls c join public.purchases pu on pu.id = c.purchase_id left join public.profiles pr on pr.id = pu.coordinator_id
where c.status = 'open' group by 1, 2 order by 1, 2;
select count(*) as closed_by_go_live_rule from public.calls where closed_note is not null;

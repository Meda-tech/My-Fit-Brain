-- Checks for supabase/migrations/20261123400000_call_choices.sql. SELECT only, changes nothing.
-- Every row: ok = true. The last query counts the choices in the call history (no ok column).

select 'wider allowed values: call history choice talked; the follow-up rule covers talked' as check,
  pg_get_constraintdef((select oid from pg_constraint where conname = 'call_logs_choice_check')) like '%talked%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'call_logs_follow_up')) like '%talked%' as ok;

select 'call_mark() takes only talked, not_picked, not_interested; Not interested after at least 2 calls' as check,
  pg_get_functiondef('public.call_mark(uuid, uuid, text, text, text, timestamptz)'::regprocedure) like '%NOT IN (''talked'', ''not_picked'', ''not_interested'')%'
  and pg_get_functiondef('public.call_mark(uuid, uuid, text, text, text, timestamptz)'::regprocedure) like '%At least 2 calls are needed first.%' as ok;

select 'only the server may call it' as check,
  not has_function_privilege('anon', 'public.call_mark(uuid, uuid, text, text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.call_mark(uuid, uuid, text, text, text, timestamptz)', 'execute') as ok;

select 'every Talked to client line has a follow-up' as check,
  not exists (select 1 from public.call_logs where choice = 'talked' and follow_up_at is null) as ok;

-- In words: choices in the call history (old ones stay as they were).
select coalesce(choice, '-') as choice, count(*) as n from public.call_logs where entry = 'call' group by choice order by choice;

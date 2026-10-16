-- Verification for supabase/migrations/20261021000000_paid_attempt_atomic.sql.
-- Run after the migration in the Supabase SQL Editor.

-- 1. The function exists and only the service role may call it.
select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef as security_definer
from pg_proc p where p.proname = 'create_paid_attempt' and p.pronamespace = 'public'::regnamespace;
select has_function_privilege('anon', 'public.create_paid_attempt(uuid,text,uuid,text,timestamptz)', 'execute') as anon,           -- false
       has_function_privilege('authenticated', 'public.create_paid_attempt(uuid,text,uuid,text,timestamptz)', 'execute') as auth,  -- false
       has_function_privilege('service_role', 'public.create_paid_attempt(uuid,text,uuid,text,timestamptz)', 'execute') as service; -- true

-- 2. Same payment twice gives one attempt and takes one number. Run this block ON ITS OWN (select
--    from "begin;" to "rollback;" and run): the SQL Editor shows only the last result table.
--    Everything is rolled back, so nothing is kept (uses the first client and the live Intimacy version).
--    Expect one row: first_created = true, second_created = false, same_attempt = true, numbers_taken = 1.
begin;
create temp table paid_attempt_check (
  first_created boolean, second_created boolean, same_attempt boolean, numbers_taken integer
) on commit drop;
do $$
declare
  v_client uuid := (select id from public.clients order by created_at limit 1);
  v_version uuid := (select id from public.qb_versions where test_code = 'IA' and status = 'live');
  v_year integer := extract(year from (now() at time zone 'Asia/Kolkata'))::int;
  v_before integer := coalesce((select last_number from public.report_counters where test_code = 'IA' and year = v_year), 0);
  a jsonb;
  b jsonb;
begin
  a := public.create_paid_attempt(v_client, 'IA', v_version, 'pay_verify_check', now());
  b := public.create_paid_attempt(v_client, 'IA', v_version, 'pay_verify_check', now());
  insert into paid_attempt_check values (
    (a->>'created')::boolean,
    (b->>'created')::boolean,
    (a->'attempt'->>'id') = (b->'attempt'->>'id'),
    (select last_number from public.report_counters where test_code = 'IA' and year = v_year) - v_before
  );
end;
$$;
select * from paid_attempt_check;
rollback;

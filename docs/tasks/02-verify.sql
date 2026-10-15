-- ==============================================================================
-- Task 02 — checks to run in the Supabase SQL Editor AFTER
-- supabase/migrations/20261015000000_mfb_foundation.sql.
-- Read-only except the two test inserts, which are always rolled back.
-- ==============================================================================

-- 1. Current values (expect no 'Other' anywhere)
select gender, count(*) from public.clients group by 1 order by 1;
select marital_status, count(*) from public.clients group by 1 order by 1;
select role, count(*) from public.profiles group by 1 order by 1;

-- 2. Constraints now in place
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('public.clients'::regclass, 'public.profiles'::regclass)
  and conname in ('clients_gender_check', 'clients_marital_status_check',
                  'clients_age_check', 'profiles_role_check')
order by conname;

-- 3. is_counsellor() exists; only authenticated (plus owner/service_role) may execute
select p.proname, p.provolatile, p.prosecdef,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute')          as anon_can_execute
from pg_proc p
where p.proname = 'is_counsellor' and p.pronamespace = 'public'::regnamespace;

-- 4. Rejection tests. Each NOTICE should say "rejected as expected".
--    Nothing is saved: a rejected insert writes nothing, and an accepted one is undone.
do $$
begin
  begin
    insert into public.clients (phone, full_name, gender, age, marital_status)
    values ('+910000000001', 'Verify Gender', 'Other', 30, 'Single');
    raise exception 'undo';
  exception
    when check_violation then raise notice 'gender Other: rejected as expected';
    when others then
      if sqlerrm = 'undo' then raise notice 'gender Other: ACCEPTED (unexpected)';
      else raise notice 'gender Other: other error: %', sqlerrm; end if;
  end;

  begin
    insert into public.clients (phone, full_name, gender, age, marital_status)
    values ('+910000000002', 'Verify Age', 'Male', 17, 'Single');
    raise exception 'undo';
  exception
    when check_violation then raise notice 'age 17: rejected as expected';
    when others then
      if sqlerrm = 'undo' then raise notice 'age 17: ACCEPTED (unexpected)';
      else raise notice 'age 17: other error: %', sqlerrm; end if;
  end;

  begin
    insert into public.clients (phone, full_name, gender, age, marital_status)
    values ('+910000000003', 'Verify OK', 'Prefer not to say', 30, 'In a relationship');
    raise exception 'undo';
  exception
    when others then
      if sqlerrm = 'undo' then raise notice 'valid new values: accepted as expected (undone)';
      else raise notice 'valid new values: REJECTED (unexpected): %', sqlerrm; end if;
  end;
end;
$$;

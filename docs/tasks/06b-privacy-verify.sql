-- Verification for supabase/migrations/20261019000000_attempt_privacy.sql (read-only).
-- Run after the migration in the Supabase SQL Editor.

-- 1. The helper exists and only signed-in users may call it.
select proname, prosecdef as security_definer
from pg_proc where proname = 'can_view_reports' and pronamespace = 'public'::regnamespace;
select has_function_privilege('anon', 'public.can_view_reports()', 'execute') as anon_can_call,          -- expect false
       has_function_privilege('authenticated', 'public.can_view_reports()', 'execute') as auth_can_call; -- expect true

-- 2. Policies: answers and results use can_view_reports(); attempts and events unchanged.
select tablename, policyname, cmd, qual
from pg_policies
where schemaname = 'public' and tablename in ('attempts', 'attempt_answers', 'attempt_results', 'attempt_events')
order by tablename, policyname;
-- Expect: attempt_answers_select and attempt_results_select → can_view_reports();
--         attempts_select → is_active_staff() OR own client; attempt_events_select → is_active_staff().

-- 3. Who can view reports today (should list super admins and counsellors only).
select full_name, role, is_active from public.profiles
where role in ('super_admin', 'counsellor') and is_active = true
order by role, full_name;

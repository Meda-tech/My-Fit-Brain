-- Checks for 20261105000000_attempt_conclusions.sql. SELECT only; changes nothing.

-- 1. The table and its columns (expect 7 rows).
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'attempt_conclusions'
order by ordinal_position;

-- 2. RLS is on (expect true) and the one read policy uses can_view_reports().
select relrowsecurity from pg_class where oid = 'public.attempt_conclusions'::regclass;
select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'attempt_conclusions';

-- 3. Both triggers are there (expect trg_attempt_conclusions_guard and trg_attempt_conclusions_updated_at).
select tgname from pg_trigger where tgrelid = 'public.attempt_conclusions'::regclass and not tgisinternal order by tgname;

-- 4. Every conclusion belongs to a completed attempt (expect 0).
select count(*) as not_completed
from public.attempt_conclusions c join public.attempts a on a.id = c.attempt_id
where a.status <> 'completed';

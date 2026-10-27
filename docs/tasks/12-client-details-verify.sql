-- Checks for 20261027000000_client_details.sql. SELECT only; changes nothing.

-- 1. The column exists, with an empty list by default. Expect: client_details | jsonb | NO | '[]'::jsonb
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'questionnaires' and column_name = 'client_details';

-- 2. Each questionnaire's current list (how many questions).
select code, jsonb_array_length(client_details) as client_details_questions
from public.questionnaires
order by sort;

-- 3. The answers table has RLS on, and one SELECT policy. Expect: true, attempt_details_select
select c.relrowsecurity, p.policyname, p.cmd
from pg_class c
left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
where c.oid = 'public.attempt_details'::regclass;

-- 4. The lock trigger is attached. Expect: trg_attempt_details_guard
select tgname from pg_trigger where tgrelid = 'public.attempt_details'::regclass and not tgisinternal;

-- 5. After a test assessment: its typed answers, with the question as it was asked.
select a.report_id, d.sort, d.question ->> 'en' as question, d.answer, d.answered_at
from public.attempt_details d
join public.attempts a on a.id = d.attempt_id
order by a.report_id, d.sort;

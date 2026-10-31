-- Checks for 20261031000001_drop_pay_code.sql. SELECT only: run in the Supabase SQL Editor after it.

-- 1. The column is gone (expect 0 rows).
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'questionnaires' and column_name = 'pay_code';

-- 2. Its index and check are gone (expect 0 rows).
select indexname as name from pg_indexes where schemaname = 'public' and indexname = 'uq_questionnaires_pay_code'
union all
select conname from pg_constraint where conname = 'questionnaires_pay_code_format';

-- 3. The questionnaires are all still there (expect IA and MA, plus any you added).
select code, name_en from public.questionnaires order by sort;

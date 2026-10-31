-- Checks for 20261031000002_questionnaire_active.sql. SELECT only: run in the Supabase SQL Editor after it.

-- 1. The new columns exist (expect 3 rows; is_active not nullable, default true).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'questionnaires'
  and column_name in ('is_active', 'active_changed_at', 'active_changed_by')
order by column_name;

-- 2. Every questionnaire and whether it is on (expect all true right after the migration).
select code, name_en, is_active, active_changed_at from public.questionnaires order by sort;

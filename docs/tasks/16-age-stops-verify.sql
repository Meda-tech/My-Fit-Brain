-- Checks for 20261031000004_age_stops.sql. SELECT only: run in the Supabase SQL Editor after it.

-- 1. The table exists with RLS on (expect one row, rowsecurity = true).
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename = 'age_stops';

-- 2. Its read policy (expect age_stops_select, SELECT).
select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'age_stops';

-- 3. Under-18 stops so far, newest first, with their purchases (empty until someone is stopped).
select s.phone, s.full_name, s.age, s.first_at, s.last_at,
       count(p.id) filter (where p.status = 'paid') as paid_purchases,
       count(p.id) filter (where p.refund_status = 'needed') as refund_needed
from public.age_stops s
left join public.payments p on p.phone = s.phone
group by s.id
order by s.last_at desc;

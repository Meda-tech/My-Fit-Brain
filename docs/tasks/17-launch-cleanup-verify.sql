-- Checks for 17-launch-cleanup.sql. SELECT only: run BEFORE it (to see what will be removed) and AFTER it.

-- 1. Rows per table. After the cleanup every count is 0.
select 'payments' as data, count(*) from public.payments
union all select 'payment_events', count(*) from public.payment_events
union all select 'payment_moves', count(*) from public.payment_moves
union all select 'attempts', count(*) from public.attempts
union all select 'attempt_answers', count(*) from public.attempt_answers
union all select 'attempt_results', count(*) from public.attempt_results
union all select 'attempt_alerts', count(*) from public.attempt_alerts
union all select 'attempt_details', count(*) from public.attempt_details
union all select 'report_counters', count(*) from public.report_counters
union all select 'age_stops', count(*) from public.age_stops
union all select 'clients', count(*) from public.clients;

-- 2. The team. After: only super admins, plus any coordinator kept inactive because a questionnaire names them.
select role, is_active, full_name, email, auth_user_id is not null as has_login
from public.profiles
order by role, full_name;

-- 3. Logins. After: only the super admins' logins.
select count(*) as logins,
       count(*) filter (where u.id in (select auth_user_id from public.profiles where role = 'super_admin')) as super_admin_logins
from auth.users u;

-- 4. Questionnaires: must be the SAME before and after.
select q.code, q.name_en, q.is_active,
       jsonb_array_length(coalesce(q.client_details, '[]'::jsonb)) as client_details,
       count(v.id) as versions,
       count(v.id) filter (where v.status = 'live') as live
from public.questionnaires q
left join public.questionnaire_versions v on v.questionnaire_code = q.code
group by q.code
order by q.code;

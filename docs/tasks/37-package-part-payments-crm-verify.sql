-- Checks for supabase/migrations/20261124000000_package_part_payments_crm.sql. SELECT only, changes nothing.
-- Every row: ok = true. The last queries are for reading (no ok column).

select 'wider allowed values: role crm · call outcome package_started · events package_part_paid, package_started · a part amount is allowed' as check,
  pg_get_constraintdef((select oid from pg_constraint where conname = 'profiles_role_check')) like '%crm%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'calls_outcome_check')) like '%package_started%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'call_logs_event_check')) like '%package_part_paid%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'call_logs_event_check')) like '%package_started%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'package_payments_amount')) like '%<=%' as ok
union all
select 'no existing role, call outcome or call event was lost by the wider lists',
  not exists (select 1 from public.profiles where role not in ('super_admin', 'coordinator', 'counsellor', 'crm'))
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'calls_outcome_check')) like '%package_paid%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'calls_outcome_check')) like '%not_needed%'
  and pg_get_constraintdef((select oid from pg_constraint where conname = 'call_logs_event_check')) like '%package_refund_needed%'
union all
select 'package amounts are settings: first payment minimum, start amount, milestones (one active package)',
  (select count(*) = 1 and bool_and(first_min_paise > 0 and first_min_paise <= start_paise and start_paise <= price_paise
                                    and jsonb_typeof(milestones) = 'array')
   from public.packages where is_active)
union all
select 'milestones: sessions and amounts go up, each with a session number and an amount',
  not exists (
    select 1 from public.packages k
    cross join lateral (select (e->>'session')::int as session, (e->>'paid_paise')::int as paise, ord
                        from jsonb_array_elements(k.milestones) with ordinality x(e, ord)) m
    cross join lateral (select (e->>'session')::int as session, (e->>'paid_paise')::int as paise, ord
                        from jsonb_array_elements(k.milestones) with ordinality x(e, ord)) n
    where k.is_active and n.ord = m.ord + 1 and (n.session <= m.session or n.paise <= m.paise))
union all
select 'new tables have RLS on with one read rule each and no write rule: crm_round_robin, client_crms, crm_client_moves',
  (select count(*) = 3 from pg_tables where schemaname = 'public' and rowsecurity and tablename in ('crm_round_robin', 'client_crms', 'crm_client_moves'))
  and (select count(*) = 3 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename in ('crm_round_robin', 'client_crms', 'crm_client_moves'))
union all
select 'the older access rules are still there, unchanged in number (purchases 1 read rule, package_payments 1 read rule)',
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchases' and policyname = 'purchases_select' and permissive = 'PERMISSIVE')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'package_payments' and policyname = 'package_payments_select' and permissive = 'PERMISSIVE')
  and (select count(*) = 7 from pg_policies where schemaname = 'public' and policyname like '%_counsellor_own')
union all
select 'a CRM login is closed out of clients, assessments, answers, results, client details, conclusions, safety alerts and questionnaire versions (8 RESTRICTIVE rules)',
  (select count(*) = 8 and bool_and(permissive = 'RESTRICTIVE' and cmd = 'ALL') from pg_policies
   where schemaname = 'public' and policyname like '%_not_crm'
     and tablename in ('clients', 'attempts', 'attempt_answers', 'attempt_details', 'attempt_results', 'attempt_alerts', 'attempt_conclusions', 'questionnaire_versions'))
union all
select 'Package purchases: rows for super admins only; package payments after the handover hidden from coordinators (2 RESTRICTIVE rules) and readable by the client''s CRM (1 rule)',
  exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'purchases' and policyname = 'purchases_packages_admin_only' and permissive = 'RESTRICTIVE')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'package_payments' and policyname = 'package_payments_after_handover' and permissive = 'RESTRICTIVE')
  and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'package_payments' and policyname = 'package_payments_select_crm' and permissive = 'PERMISSIVE')
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.package_amounts_save(uuid, integer, integer, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.move_crm_clients(uuid, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.package_settle(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.package_start_if_due(uuid, timestamptz, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.package_balance(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.client_crm(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.crm_packages()', 'EXECUTE')
union all
select 'the CRM dashboard function checks the signed-in user itself and is the only way a CRM reads a client''s name',
  has_function_privilege('authenticated', 'public.crm_packages()', 'EXECUTE')
  and pg_get_functiondef('public.crm_packages()'::regprocedure) like '%auth.uid()%'
union all
select 'every counted package payment is paid and not flagged for a refund; every refund-flagged one is not counted',
  not exists (select 1 from public.package_payments where counted_at is not null and (status <> 'paid' or refund_status is not null))
union all
select 'paid in total for a package purchase is never more than the package amount',
  not exists (select 1 from public.package_payments pp
              where pp.status = 'paid' and pp.refund_status is null and pp.counted_at is not null
              group by pp.purchase_id
              having sum(pp.amount_paise) > min(pp.price_paise - pp.advance_paise))
union all
select 'no package waits to start: none is paid up to the start amount without a Package purchase; none started with nothing paid',
  not exists (select 1 from public.purchases pu cross join lateral public.package_balance(pu.id) b
              where pu.kind = 'assessment' and ((not b.started and b.paid_paise > 0 and b.paid_paise >= b.start_paise) or (b.started and b.paid_paise = 0)))
union all
select 'a started package: Package purchase with the package amount; payments made after the handover are marked so',
  not exists (select 1 from public.purchases x
              where x.kind = 'package' and x.status = 'paid'
                and x.amount_paise is distinct from (select min(pp.price_paise - pp.advance_paise) from public.package_payments pp
                                                     where pp.package_purchase_id = x.id and pp.counted_at is not null))
  and not exists (select 1 from public.package_payments where after_handover and package_purchase_id is null and refund_status is null)
union all
select 'only Package purchases carry a CRM; the CRM is a CRM profile; it matches the client''s CRM (client_crms)',
  not exists (select 1 from public.purchases x where x.crm_id is not null
              and (x.kind <> 'package' or not exists (select 1 from public.profiles p where p.id = x.crm_id and p.role = 'crm')
                   or x.crm_id is distinct from (select c.crm_id from public.client_crms c where c.phone = x.phone)))
union all
select 'no package waits for a CRM while a CRM is active',
  not (exists (select 1 from public.profiles where role = 'crm' and is_active)
       and exists (select 1 from public.purchases where kind = 'package' and crm_id is null))
union all
select 'no inactive CRM still has clients',
  not exists (select 1 from public.client_crms c join public.profiles p on p.id = c.crm_id where not p.is_active)
union all
select 'triggers: CRM moves are never changed; no Make inactive with clients; a new CRM takes the waiting packages',
  (select count(*) = 3 from pg_trigger where not tgisinternal and tgname in ('crm_client_moves_keep', 'profiles_keep_crm_clients', 'profiles_crm_assign'))
union all
select 'Mark as call done: Not interested on a Package call with money received is for super admins only',
  pg_get_functiondef('public.call_mark(uuid, uuid, text, text, text, timestamptz)'::regprocedure) like '%Only an admin can mark Not interested.%'
union all
select 'the assessment payments table is untouched: no package or CRM column',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments'
              and column_name in ('crm_id', 'counted_at', 'after_handover', 'package_id'));

-- For reading: the package amounts, staff by role, and packages by state.
select first_min_paise / 100 as first_min_rupees, start_paise / 100 as start_rupees, milestones from public.packages where is_active;
select role, count(*) filter (where is_active) as active, count(*) filter (where not is_active) as inactive from public.profiles group by role order by role;
select count(*) filter (where b.started) as started, count(*) filter (where not b.started and b.paid_paise > 0) as part_paid_not_started,
       count(*) filter (where b.started and b.remaining_paise = 0) as paid_in_full
from public.purchases pu cross join lateral public.package_balance(pu.id) b where pu.kind = 'assessment';

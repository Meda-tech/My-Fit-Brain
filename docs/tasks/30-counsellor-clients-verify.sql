-- Checks for supabase/migrations/20261121600000_counsellor_clients.sql. SELECT only, changes nothing.
-- Every row: ok = true.

select 'tables client_counsellors and counsellor_client_moves exist, with access rules on' as check,
  (select count(*) = 2 from pg_class where relnamespace = 'public'::regnamespace
     and relname in ('client_counsellors', 'counsellor_client_moves') and relrowsecurity) as ok;

select 'every booking''s client is assigned to that booking''s counsellor (or moved on)' as check,
  not exists (
    select 1 from public.presentation_bookings b join public.purchases pu on pu.id = b.purchase_id
    where pu.client_id is not null
      and not exists (select 1 from public.client_counsellors cc
                      where cc.client_id = pu.client_id and cc.counsellor_id = b.counsellor_id)) as ok;

select 'counsellor rules on the 7 client and report tables (restrictive)' as check,
  (select count(*) = 7 from pg_policies where schemaname = 'public' and permissive = 'RESTRICTIVE'
     and policyname in ('clients_counsellor_own', 'attempts_counsellor_own', 'attempt_answers_counsellor_own',
                        'attempt_details_counsellor_own', 'attempt_results_counsellor_own', 'attempt_alerts_counsellor_own',
                        'attempt_conclusions_counsellor_own')) as ok;

select 'the earlier access rules are all still there' as check,
  (select count(*) = 9 from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE'
     and policyname in ('clients_select_policy', 'clients_insert_policy', 'clients_update_policy', 'attempts_select',
                        'attempt_answers_select', 'attempt_details_select', 'attempt_results_select', 'attempt_alerts_select',
                        'attempt_conclusions_select')) as ok;

select 'triggers: assign on booking, keep assignments and moves, no Make inactive while a counsellor has clients' as check,
  (select count(*) = 4 from pg_trigger where not tgisinternal and tgname in
     ('presentation_bookings_assign', 'client_counsellors_keep', 'counsellor_client_moves_keep', 'profiles_keep_counsellor_clients')) as ok;

select 'no active counsellor assignment points to an inactive counsellor without a way to move it' as check,
  not exists (select 1 from public.client_counsellors cc join public.profiles p on p.id = cc.counsellor_id
              where cc.ended_at is null and p.role <> 'counsellor') as ok;

select 'only the server may move clients or list clashes' as check,
  not has_function_privilege('authenticated', 'public.move_counsellor_clients(uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.counsellor_move_clashes(uuid, uuid)', 'execute') as ok;

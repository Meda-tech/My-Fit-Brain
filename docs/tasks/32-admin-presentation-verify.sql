-- Checks for supabase/migrations/20261121800000_admin_presentation_done.sql, and (the last block) for the one-time
-- go-live step supabase/go-live/assign-old-clients.sql. SELECT only, changes nothing. Every row: ok = true.
-- The behaviour is tried in supabase/staging/staging-test-admin-presentation.sql (rolled back).

select 'a presentation without a slot is always one marked done by an admin, and the other way round' as check,
  not exists (select 1 from public.presentation_bookings
              where (start_time is null) <> marked_by_admin or (end_time is null) <> marked_by_admin
                 or (marked_by_admin and (done_at is null or status <> 'booked'))) as ok;

select 'only purchases from before the system were marked by an admin' as check,
  not exists (select 1 from public.presentation_bookings b join public.purchases pu on pu.id = b.purchase_id
              where b.marked_by_admin and not public.before_system(pu)) as ok;

select 'the package offer exists only where a report presentation is marked done' as check,
  not exists (select 1 from public.purchases pu cross join lateral public.package_offer(pu.id) o
              where not exists (select 1 from public.presentation_bookings b
                                where b.purchase_id = pu.id and b.status = 'booked' and b.done_at is not null)) as ok;

select 'purchases from before the system: no Payment, Assessment or Booking call is open (never due or late)' as check,
  not exists (select 1 from public.calls c join public.purchases pu on pu.id = c.purchase_id
              where c.status = 'open' and c.kind in ('payment', 'assessment', 'booking') and public.before_system(pu)) as ok;

select 'every client assigned to a counsellor has one source: a booking, a move, or the go-live step' as check,
  not exists (select 1 from public.client_counsellors
              where num_nonnulls(booking_id, move_id) + at_go_live::int <> 1) as ok;

select 'only the server may mark a presentation for an old purchase or run the go-live step' as check,
  not has_function_privilege('authenticated', 'public.presentation_mark_done_admin(uuid, uuid, date, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.go_live_assign_old_clients()', 'execute') as ok;

-- After the one-time go-live step (production): these three are true once it has run. Before it, or on staging
-- (two coordinators, two counsellors: the step stops there), they may be false.
select 'GO-LIVE STEP: exactly one active coordinator and one active counsellor' as check,
  (select count(*) = 1 from public.profiles where role = 'coordinator' and is_active)
  and (select count(*) = 1 from public.profiles where role = 'counsellor' and is_active) as ok;
select 'GO-LIVE STEP: every purchase and every client phone has the active coordinator' as check,
  not exists (select 1 from public.purchases pu
              where not exists (select 1 from public.profiles p where p.id = pu.coordinator_id and p.role = 'coordinator' and p.is_active))
  and not exists (select 1 from public.client_coordinators cc
                  where not exists (select 1 from public.profiles p where p.id = cc.coordinator_id and p.role = 'coordinator' and p.is_active)) as ok;
select 'GO-LIVE STEP: every client with a paid assessment is assigned to an active counsellor' as check,
  not exists (select 1 from public.purchases pu
              where pu.kind = 'assessment' and pu.status = 'paid' and pu.client_id is not null
                and not exists (select 1 from public.client_counsellors cc join public.profiles p on p.id = cc.counsellor_id
                                where cc.client_id = pu.client_id and cc.ended_at is null and p.is_active)) as ok;

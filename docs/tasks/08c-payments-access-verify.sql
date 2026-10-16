-- Verification for supabase/migrations/20261022000000_payments_access.sql (read-only).

-- 1. The payments policy uses can_view_payments() (or the client's own rows).
select policyname, cmd, qual from pg_policies where schemaname = 'public' and tablename = 'payments';

-- 2. Who can see payments today: active super admins and coordinators only.
select full_name, role from public.profiles
where role in ('super_admin', 'coordinator') and is_active = true order by role, full_name;

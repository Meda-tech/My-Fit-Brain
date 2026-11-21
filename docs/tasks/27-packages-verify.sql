-- Checks for supabase/migrations/20261121300000_packages.sql. SELECT only, changes nothing.
-- Every row: ok = true.

select 'packages and package_payments exist, RLS on, one read rule each, no write rule' as check,
  (select count(*) = 2 from pg_tables where schemaname = 'public' and rowsecurity and tablename in ('packages', 'package_payments'))
  and (select count(*) = 2 and bool_and(cmd = 'SELECT') from pg_policies where schemaname = 'public' and tablename in ('packages', 'package_payments')) as ok
union all
select 'exactly one active package',
  (select count(*) = 1 from public.packages where is_active)
union all
select 'the payments table (assessment payments) has no package column',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payments'
              and column_name in ('package_id', 'purpose', 'kind', 'parent_purchase_id'))
union all
select 'every package payment: amount = package price − advance (calculated by the database)',
  not exists (select 1 from public.package_payments where amount_paise <> price_paise - advance_paise or amount_paise <= 0)
union all
select 'the advance of a package payment = the amount paid for its assessment purchase',
  not exists (select 1 from public.package_payments pp join public.purchases pu on pu.id = pp.purchase_id
              where pp.advance_paise <> pu.amount_paise or pu.kind <> 'assessment')
union all
select 'a Package purchase is paid, has its assessment purchase (same client, phone, coordinator) and one paid payment',
  not exists (select 1 from public.purchases x join public.purchases pu on pu.id = x.parent_purchase_id
              where x.kind = 'package'
                and (pu.kind <> 'assessment' or x.client_id is distinct from pu.client_id or x.phone <> pu.phone
                     or (select count(*) from public.package_payments pp where pp.package_purchase_id = x.id and pp.status = 'paid') <> 1))
  and not exists (select 1 from public.purchases where (kind = 'package') <> (parent_purchase_id is not null))
union all
select 'one paid package per assessment purchase at most (the database refuses a second)',
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'purchases_one_package_per_parent')
  and not exists (select 1 from public.purchases where kind = 'package' and status = 'paid' group by parent_purchase_id having count(*) > 1)
union all
select 'a paid package payment made a Package purchase, or is flagged for a refund (paid twice)',
  not exists (select 1 from public.package_payments where status = 'paid' and (package_purchase_id is null) = (refund_status is null))
union all
select 'package paid: its Package call is closed as Package paid, journey Package call actual = paid time',
  not exists (select 1 from public.purchases x
              join public.package_payments pp on pp.package_purchase_id = x.id
              join public.purchase_stages s on s.purchase_id = x.parent_purchase_id and s.stage = 'package_call'
              left join public.calls c on c.purchase_id = x.parent_purchase_id and c.kind = 'package'
              where x.kind = 'package' and x.status = 'paid'
                and (s.done_at is distinct from pp.paid_at or (c.id is not null and c.outcome is distinct from 'package_paid')))
union all
select 'manual package payments carry reference, proof, who recorded and the accounts check; Razorpay ones none',
  not exists (select 1 from public.package_payments
              where (provider = 'offline') <> (accounts_check is not null)
                 or (provider = 'offline' and (reference is null or proof_url is null or recorded_by is null)))
union all
select 'a package offer exists only after the report presentation is done and before a package is paid',
  not exists (select 1 from public.purchases pu cross join lateral public.package_offer(pu.id) o
              where not exists (select 1 from public.presentation_bookings b where b.purchase_id = pu.id and b.done_at is not null)
                 or exists (select 1 from public.purchases x where x.parent_purchase_id = pu.id and x.status = 'paid'))
union all
select '"Client agreed – will pay" keeps the call open with a follow-up; Done is not used on Package calls from now on',
  not exists (select 1 from public.call_logs l join public.calls c on c.id = l.call_id
              where l.choice = 'agreed' and (c.kind <> 'package' or l.follow_up_at is null))
union all
select 'package payments are never removed (trigger)',
  exists (select 1 from pg_trigger where tgname = 'package_payments_keep' and not tgisinternal)
union all
select 'the writing functions cannot be called from a browser session',
  not has_function_privilege('authenticated', 'public.package_payment_manual(uuid, uuid, uuid, text, text, text, timestamptz, text, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.package_payment_start(uuid, uuid, uuid, text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.package_payment_mark_paid(uuid, text, text, timestamptz)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.package_save(uuid, text, integer, text, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.package_offer(uuid)', 'EXECUTE');

-- For reading: the package, and package payments by status.
select name, sessions, frequency, price_paise / 100 as price_rupees from public.packages where is_active;
select provider, status, coalesce(refund_status, '-') as refund, count(*) from public.package_payments group by 1, 2, 3 order by 1, 2;

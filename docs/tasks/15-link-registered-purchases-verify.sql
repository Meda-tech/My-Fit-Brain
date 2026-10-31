-- Checks for 20261031000003_link_registered_purchases.sql. SELECT only: run in the Supabase SQL Editor after it.

-- 1. Purchases still unlinked although the number belongs to a registered client (expect 0 rows).
select p.id, p.phone, p.status, p.created_at
from public.payments p
join public.clients c
  on c.phone in (p.phone, substr(p.phone, 2), right(p.phone, 10)) and c.auth_user_id is not null
where p.client_id is null and p.attempt_id is null and p.refund_status is null;

-- 2. Purchases with no client yet: numbers nobody has logged in with (any rows here are expected).
select id, phone, status, created_at from public.payments where client_id is null order by created_at desc;

-- 3. Every purchase that has a client also has claimed_at, and the other way round (expect 0 rows).
select id from public.payments where (client_id is null) <> (claimed_at is null);

-- Checks for 20261103000000_offline_payments.sql and 20261103000001_drop_google_drive_connection.sql.
-- SELECT only: nothing is changed.

-- 1. The two wider rules (expect 2 rows: provider allows razorpay + offline; status adds cancelled).
select conname, pg_get_constraintdef(oid) as rule
from pg_constraint
where conrelid = 'public.payments'::regclass and conname in ('payments_provider_check', 'payments_status_check');

-- 2. No other single-column rule left on provider or status (expect 0).
select count(*) as old_rules_left
from pg_constraint c
join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
where c.conrelid = 'public.payments'::regclass and c.contype = 'c' and cardinality(c.conkey) = 1
  and a.attname in ('provider', 'status') and c.conname not in ('payments_provider_check', 'payments_status_check');

-- 3. The new rules (expect 3 rows).
select conname from pg_constraint
where conrelid = 'public.payments'::regclass and conname in ('payments_offline_details', 'payments_note_length', 'payments_cancelled');

-- 4. The new columns (expect 8 rows).
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'payments'
  and column_name in ('reference', 'note', 'recorded_by', 'proof_file_id', 'proof_url', 'cancelled_at', 'cancelled_by', 'cancel_reason')
order by column_name;

-- 5. Existing payments are all still there and unchanged in kind (compare with the count before running).
select provider, status, count(*) from public.payments group by 1, 2 order by 1, 2;

-- 6. The guard knows about offline payments (expect true).
select pg_get_functiondef('public.payment_guard()'::regprocedure) like '%offline%' as guard_updated;

-- 7. The OAuth token table is gone after 20261103000001_drop_google_drive_connection.sql (expect null).
select to_regclass('public.google_drive_connection') as oauth_table;

-- 8. Offline payments recorded so far.
select id, test_code, method, reference, status, paid_at, proof_url, recorded_by, cancelled_at, cancel_reason
from public.payments where provider = 'offline' order by created_at desc limit 50;

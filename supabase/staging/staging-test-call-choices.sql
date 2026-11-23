-- STAGING ONLY. Behaviour test for the new "Mark as call done" choices on every call (owner, 2026-11-23):
-- Talked to client · Not picked / Call later (follow-up within 2 working days) · Not interested (after at least 2 calls,
-- reason). No Done, no Client agreed, no Call later. One transaction, ROLLED BACK. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-call-choices.sql

\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE email = 'superadmin@example.com') THEN
    RAISE EXCEPTION 'Not the staging database. Stopping.';
  END IF;
END $$;

CREATE TEMP TABLE t ON COMMIT DROP AS
SELECT (SELECT id FROM public.profiles WHERE email = 'superadmin@example.com') AS admin;

CREATE FUNCTION pg_temp.fails_with(p_sql text, p_message text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM = p_message;
END;
$$;

-- p_stage: 0 = unpaid try 45 minutes old (Payment call), 1 = paid (Assessment call), 2 = completed (Booking call),
-- 3 = presentation done (Package call). Returns the open call of that stage.
CREATE FUNCTION pg_temp.call_at(p_n int, p_stage int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_phone text := '+91999990091' || p_n;
  v_client uuid := ('5eed0000-0000-4000-8000-0000000f91c' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-0000000f910' || p_n)::uuid;
  v_ref text := 'offline_g' || p_n;
  v_purchase uuid;
BEGIN
  IF p_stage = 0 THEN
    INSERT INTO public.payments (id, phone, test_code, amount_paise, currency, provider_order_id, created_at)
    VALUES (v_pay, v_phone, 'IA', 350000, 'INR', 'order_g' || p_n, now() - interval '45 minutes');
    RETURN (SELECT c.id FROM public.calls c JOIN public.purchase_payments pp ON pp.purchase_id = c.purchase_id
            WHERE pp.payment_id = v_pay AND c.kind = 'payment');
  END IF;
  INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
  VALUES (v_client, v_phone, 'Choices Test ' || p_n, 'Female', 30, 'Single');
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method,
                               reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
  SELECT v_pay, v_phone, 'IA', 'offline', 350000, 'paid', v_ref, v_ref, now(), 'upi', 'UPI-G-' || p_n, admin,
         'fake-proof', 'https://drive.example/fake-proof', v_client, now() FROM t;
  SELECT purchase_id INTO v_purchase FROM public.purchase_payments WHERE payment_id = v_pay;
  IF p_stage >= 2 THEN
    PERFORM public.create_paid_attempt(v_client, 'IA', (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
    UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE id = v_pay;
    UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
    UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  END IF;
  IF p_stage >= 3 THEN
    PERFORM public.presentation_book(v_purchase, f.counsellor_id, f.on_date, f.start_time, (SELECT admin FROM t))
    FROM (SELECT * FROM public.free_presentation_slots(current_date, public.booking_last_day()) ORDER BY on_date, start_time LIMIT 1) f;
    PERFORM public.presentation_mark_done((SELECT id FROM public.presentation_bookings WHERE purchase_id = v_purchase AND status = 'booked'),
                                          (SELECT admin FROM t));
  END IF;
  RETURN (SELECT id FROM public.calls WHERE purchase_id = v_purchase AND status = 'open'
          AND kind = CASE p_stage WHEN 1 THEN 'assessment' WHEN 2 THEN 'booking' ELSE 'package' END);
END;
$$;

SELECT 'test numbers unused', NOT EXISTS (SELECT 1 FROM public.payments WHERE phone LIKE '+91999990091_');
CREATE TEMP TABLE c ON COMMIT DROP AS
SELECT k.kind, pg_temp.call_at(k.n, k.n) AS id
FROM (VALUES (0, 'payment'), (1, 'assessment'), (2, 'booking'), (3, 'package')) AS k(n, kind);
SELECT 'each of the four calls is open', (SELECT count(*) = 4 AND bool_and(id IS NOT NULL) FROM c);

SELECT 'Done, Client agreed and Call later are refused on every call',
  bool_and(pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''done'', null, null, null)', id, (SELECT admin FROM t)), 'Choose what happened on the call.')
       AND pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''agreed'', null, null, %L)', id, (SELECT admin FROM t), now() + interval '1 hour'), 'Choose what happened on the call.')
       AND pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''call_later'', null, null, %L)', id, (SELECT admin FROM t), now() + interval '1 hour'), 'Choose what happened on the call.'))
FROM c;
SELECT 'Talked to client needs a follow-up within 2 working days',
  bool_and(pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''talked'', null, null, null)', id, (SELECT admin FROM t)), 'Pick a follow-up date and time within 2 working days.')
       AND pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''talked'', null, null, %L)', id, (SELECT admin FROM t), public.add_working_hours(now(), 19)),
                              'Pick a follow-up date and time within 2 working days.'))
FROM c;

SELECT public.call_mark(id, (SELECT admin FROM t), 'talked', null, 'Explained', public.add_working_hours(now(), 2)) FROM c;
SELECT 'after Talked to client: every call stays open, due at the follow-up; Not interested still refused (1 call)',
  bool_and(cl.status = 'open' AND cl.due_at = public.add_working_hours(now(), 2)
           AND pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', ''other'', null, null)', c.id, (SELECT admin FROM t)),
                                  'At least 2 calls are needed first.'))
FROM c JOIN public.calls cl ON cl.id = c.id;

SELECT public.call_mark(id, (SELECT admin FROM t), 'not_picked', null, null, public.add_working_hours(now(), 18)) FROM c;
SELECT 'Not picked / Call later: open, due at the follow-up (the 2-working-day limit itself is allowed)',
  bool_and(cl.status = 'open' AND cl.due_at = public.add_working_hours(now(), 18)) FROM c JOIN public.calls cl ON cl.id = c.id;

SELECT 'after 2 calls, Not interested still needs a reason',
  bool_and(pg_temp.fails_with(format('SELECT public.call_mark(%L, %L, ''not_interested'', null, null, null)', id, (SELECT admin FROM t)), 'Choose a reason.'))
FROM c;
SELECT public.call_mark(id, (SELECT admin FROM t), 'not_interested', 'not_now', 'Maybe next month', null) FROM c;
SELECT 'Not interested closes every call (the Payment call also closes its unpaid try)',
  (SELECT bool_and(cl.status = 'closed' AND cl.outcome = 'not_interested') FROM c JOIN public.calls cl ON cl.id = c.id)
  AND (SELECT pu.closed_reason = 'not_interested' FROM c JOIN public.calls cl ON cl.id = c.id JOIN public.purchases pu ON pu.id = cl.purchase_id
       WHERE c.kind = 'payment');
SELECT 'history kept with every choice and note (3 calls each)',
  (SELECT bool_and(n = 3) FROM (SELECT count(*) AS n FROM public.call_logs l JOIN c ON c.id = l.call_id WHERE l.entry = 'call' GROUP BY c.id) x);

ROLLBACK;

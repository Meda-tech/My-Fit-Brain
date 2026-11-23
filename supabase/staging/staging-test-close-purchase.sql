-- STAGING ONLY. Behaviour test for finished purchases: Not interested on any call, and "Close purchase" (owner,
-- 2026-11-23). One transaction, ROLLED BACK at the end: nothing is kept. Every row must end with t.
-- Run: powershell -File supabase/staging-migrate.ps1 -Run supabase/staging/staging-test-close-purchase.sql

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

-- A client with a paid purchase (manual payment, so it can be started); returns the purchase.
CREATE FUNCTION pg_temp.paid(p_n int) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_client uuid := ('5eed0000-0000-4000-8000-0000000c10c' || p_n)::uuid;
  v_pay uuid := ('5eed0000-0000-4000-8000-0000000c100' || p_n)::uuid;
BEGIN
  INSERT INTO public.clients (id, phone, full_name, gender, age, marital_status)
  VALUES (v_client, '+91999990061' || p_n, 'Close Test ' || p_n, 'Female', 30, 'Single');
  INSERT INTO public.payments (id, phone, test_code, provider, amount_paise, status, provider_order_id, provider_payment_id, paid_at, method,
                               reference, recorded_by, proof_file_id, proof_url, client_id, claimed_at)
  SELECT v_pay, '+91999990061' || p_n, 'IA', 'offline', 350000, 'paid', 'offline_c' || p_n, 'offline_c' || p_n, now() - interval '2 hours', 'upi',
         'UPI-CLOSE-' || p_n, admin, 'fake-proof', 'https://drive.example/fake-proof', v_client, now() FROM t;
  RETURN (SELECT purchase_id FROM public.purchase_payments WHERE payment_id = v_pay);
END;
$$;
-- Starts (and optionally completes) the assessment of client n.
CREATE FUNCTION pg_temp.assess(p_n int, p_complete boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_ref text := 'offline_c' || p_n;
BEGIN
  PERFORM public.create_paid_attempt(('5eed0000-0000-4000-8000-0000000c10c' || p_n)::uuid, 'IA',
          (SELECT id FROM public.questionnaire_versions WHERE questionnaire_code = 'IA' AND status = 'live'), v_ref, now(), 'en');
  UPDATE public.payments SET attempt_id = (SELECT id FROM public.attempts WHERE payment_ref = v_ref) WHERE provider_order_id = v_ref;
  UPDATE public.attempts SET status = 'in_progress', consent_at = now(), started_at = now() WHERE payment_ref = v_ref;
  IF p_complete THEN
    UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = v_ref;
  END IF;
END;
$$;
CREATE FUNCTION pg_temp.rows_of(p_n int) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM public.purchases WHERE phone = '+91999990061' || p_n AND kind = 'assessment';
$$;
CREATE FUNCTION pg_temp.new_try(p_n int) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.payments (phone, test_code, amount_paise, currency, provider_order_id)
  VALUES ('+91999990061' || p_n, 'IA', 350000, 'INR', 'order_close_' || p_n || '_' || gen_random_uuid());
$$;

SELECT 'test numbers unused', NOT EXISTS (SELECT 1 FROM public.payments WHERE phone LIKE '+91999990061_');

CREATE TEMP TABLE p ON COMMIT DROP AS
SELECT pg_temp.paid(1) AS p1, pg_temp.paid(2) AS p2, pg_temp.paid(3) AS p3, pg_temp.paid(4) AS p4;
CREATE TEMP TABLE co ON COMMIT DROP AS
SELECT (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p1 FROM p)) AS own,
       (SELECT id FROM public.profiles WHERE role = 'coordinator' AND is_active
          AND id IS DISTINCT FROM (SELECT coordinator_id FROM public.purchases WHERE id = (SELECT p1 FROM p)) LIMIT 1) AS other;

-- 1. Close purchase: who may, and the reason.
SELECT '1a. another coordinator cannot close it; a reason is required',
  pg_temp.fails_with(format('SELECT public.purchase_close(%L, ''Client asked'', %L)', (SELECT p1 FROM p), (SELECT other FROM co)),
                     'Only this client''s coordinator can close their purchase.')
  AND pg_temp.fails_with(format('SELECT public.purchase_close(%L, ''no'', %L)', (SELECT p1 FROM p), (SELECT own FROM co)),
                         'Write the reason (3 to 300 characters).');
SELECT public.purchase_close((SELECT p1 FROM p), '  Client   asked to stop  ', (SELECT own FROM co))::text = '' AS closed1;
SELECT '1b. the client''s coordinator closes it: who, when, why kept; its open Assessment call closes with a history line',
  (SELECT closed_reason = 'closed_by_staff' AND closed_at IS NOT NULL AND closed_by = (SELECT own FROM co) AND closed_by_name IS NOT NULL
          AND close_note = 'Client asked to stop' AND status = 'paid'
   FROM public.purchases WHERE id = (SELECT p1 FROM p))
  AND (SELECT status = 'closed' AND outcome = 'purchase_closed' AND closed_note = 'Purchase closed: Client asked to stop'
       FROM public.calls WHERE purchase_id = (SELECT p1 FROM p) AND kind = 'assessment')
  AND EXISTS (SELECT 1 FROM public.call_logs l JOIN public.calls c ON c.id = l.call_id
              WHERE c.purchase_id = (SELECT p1 FROM p) AND l.event = 'purchase_closed' AND l.note = 'Client asked to stop');
SELECT '1c. closing twice is refused',
  pg_temp.fails_with(format('SELECT public.purchase_close(%L, ''Again please'', %L)', (SELECT p1 FROM p), (SELECT admin FROM t)),
                     'This purchase is already closed.');
SELECT '1d. a closed purchase is finished: nothing open; a new try starts a new row',
  NOT EXISTS (SELECT 1 FROM public.purchase_open_for('+919999900611', 'IA'));
SELECT pg_temp.new_try(1);
SELECT '1e. ... a new row (2 rows now), not joined to the closed purchase',
  pg_temp.rows_of(1) = 2
  AND (SELECT count(*) = 1 FROM public.purchases WHERE phone = '+919999900611' AND status = 'not_paid');

-- 2. A closed purchase gets no new call and no booking; the client may still finish the assessment.
SELECT pg_temp.assess(2, false);
SELECT public.purchase_close((SELECT p2 FROM p), 'Duplicate purchase', (SELECT admin FROM t))::text = '' AS closed2;
UPDATE public.attempts SET status = 'completed', completed_at = now() WHERE payment_ref = 'offline_c2';
SELECT '2a. assessment completed after closing: no Booking call is made',
  (SELECT done_at IS NOT NULL FROM public.purchase_stages WHERE purchase_id = (SELECT p2 FROM p) AND stage = 'assessment')
  AND NOT EXISTS (SELECT 1 FROM public.calls WHERE purchase_id = (SELECT p2 FROM p) AND kind = 'booking');
SELECT '2b. and no presentation can be booked',
  pg_temp.fails_with(format('SELECT public.presentation_book(%L, %L, %L, %L, %L)', (SELECT p2 FROM p), f.counsellor_id, f.on_date, f.start_time, (SELECT admin FROM t)),
                     'This purchase is closed.')
FROM (SELECT * FROM public.free_presentation_slots(current_date, current_date + 29) ORDER BY on_date, start_time LIMIT 1) f;

-- 3. Refused while a presentation is booked and not done.
SELECT pg_temp.assess(3, true);
SELECT public.presentation_book((SELECT p3 FROM p), f.counsellor_id, f.on_date, f.start_time, (SELECT admin FROM t)) IS NOT NULL AS booked
FROM (SELECT * FROM public.free_presentation_slots(current_date, public.booking_last_day()) ORDER BY on_date, start_time LIMIT 1) f;
SELECT '3. a booked presentation must be cancelled first',
  pg_temp.fails_with(format('SELECT public.purchase_close(%L, ''Client asked'', %L)', (SELECT p3 FROM p), (SELECT admin FROM t)),
                     'A presentation is booked. Cancel the booking first.');

-- 4. Not interested on the Assessment call finishes the purchase too.
CREATE TEMP TABLE a ON COMMIT DROP AS SELECT id FROM public.calls WHERE purchase_id = (SELECT p4 FROM p) AND kind = 'assessment';
SELECT public.call_mark((SELECT id FROM a), (SELECT admin FROM t), 'not_picked', null, null, public.add_working_hours(now(), 1))::text = '' AS called;
SELECT '4a. open while the Assessment call is only followed up',
  EXISTS (SELECT 1 FROM public.purchase_open_for('+919999900614', 'IA'));
SELECT public.call_mark((SELECT id FROM a), (SELECT admin FROM t), 'not_interested', 'not_now', 'Maybe later', null)::text = '' AS not_interested;
SELECT '4b. Assessment call Not interested: finished; a new try starts a new row',
  NOT EXISTS (SELECT 1 FROM public.purchase_open_for('+919999900614', 'IA'));
SELECT pg_temp.new_try(4);
SELECT '4c. ... 2 rows now',
  pg_temp.rows_of(4) = 2;

ROLLBACK;

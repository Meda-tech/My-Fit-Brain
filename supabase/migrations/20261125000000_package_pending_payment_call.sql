-- Pending payment call after a package part payment; the start amount in at most 2 payments (owner, 2026-11-25).
-- Run after 20261124000000_package_part_payments_crm.sql.
--
-- REMOVES NOTHING. No DELETE, no DROP of a table, column, row or rule, no TRUNCATE.
--
-- Allowed-values lists (CHECK rules) replaced by WIDER ones (owner's standing permission, 2026-11-20; no row is
-- changed or removed by them): calls.kind + 'pending_payment' · calls.outcome + 'part_paid'.
--
-- Existing rows changed: a package that is part paid (paid in total below the start amount, not started) gets the new
-- flow once: its open Package call closes as "Part payment received" and a Pending payment call is made, due 2 working
-- hours from now. On production no such package exists yet (the part payments of 20261124000000 go live together with
-- this file), so nothing is changed there.
--
-- In plain words:
--   1. A part payment below the start amount (₹10,000) closes the Package call: "Part payment received". A new task
--      starts for the client's coordinator, the Pending payment call (ask the client when they will pay the rest). It
--      is due at the follow-up the coordinator booked with the client in "Add package payment": within the next
--      3 working days (27 working hours: Mon–Sat 9:00–18:00).
--   2. Mark as call done on the Pending payment call: the same choices as every call, with a follow-up within
--      3 working days (other calls keep 2). Not interested: super admins only (money is already received).
--   3. The start amount is paid in at most 2 payments: the first at least the first minimum (₹1,000), the second at
--      least the rest of the start amount (₹10,000 − ₹1,000 = ₹9,000). After the start (with CRM) any amount up to
--      the remaining balance, as before.
--   4. When the package starts, the Pending payment call closes too ("Package started").
--
-- Checks: docs/tasks/38-package-pending-payment-call-verify.sql ·
-- behaviour test supabase/staging/staging-test-package-part-payments.sql (updated for this file)

BEGIN;

-- 1. Wider allowed values ------------------------------------------------------------------------------------

ALTER TABLE public.calls DROP CONSTRAINT calls_kind_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_kind_check
  CHECK (kind IN ('payment', 'assessment', 'booking', 'package', 'pending_payment'));

ALTER TABLE public.calls DROP CONSTRAINT calls_outcome_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended', 'before_go_live', 'booked', 'package_paid',
                     'not_needed', 'package_started', 'part_paid'));

-- 2. The follow-up booked with a part payment ----------------------------------------------------------------

ALTER TABLE public.package_payments ADD COLUMN follow_up_at timestamptz;
COMMENT ON COLUMN public.package_payments.follow_up_at IS 'A part payment below the start amount: when the coordinator will call the client about the rest (within 3 working days). The Pending payment call is due then.';

-- The latest follow-up of a Pending payment call: 3 working days (27 working hours) from p_at.
CREATE OR REPLACE FUNCTION public.pending_follow_up_last(p_at timestamptz)
RETURNS timestamptz LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.add_working_hours(p_at, 27);
$$;

-- 3. The handover also closes the Pending payment call ------------------------------------------------------

-- Same as 20261124000000, plus: the Pending payment call closes ("Package started").
CREATE OR REPLACE FUNCTION public.package_start_if_due(p_purchase uuid, p_at timestamptz, p_by uuid, p_by_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  b record;
  v_new uuid;
  v_call record;
  v_manual boolean;
  v_at timestamptz := coalesce(p_at, now());
BEGIN
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase AND kind = 'assessment' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO b FROM public.package_balance(p_purchase);
  IF NOT FOUND OR b.started OR b.paid_paise <= 0 OR b.paid_paise < b.start_paise THEN
    RETURN NULL;
  END IF;

  SELECT bool_and(pp.provider = 'offline') INTO v_manual FROM public.package_payments pp
  WHERE pp.purchase_id = pu.id AND pp.status = 'paid' AND pp.refund_status IS NULL AND pp.counted_at IS NOT NULL;

  INSERT INTO public.purchases (kind, test_code, phone, client_id, amount_paise, status, source, coordinator_id, paid_at, parent_purchase_id, crm_id)
  VALUES ('package', pu.test_code, pu.phone, pu.client_id, b.total_paise, 'paid',
          CASE WHEN v_manual THEN 'manual' ELSE 'pay_page' END, pu.coordinator_id, v_at, pu.id, public.client_crm(pu.phone))
  RETURNING id INTO v_new;

  UPDATE public.package_payments SET package_purchase_id = v_new
  WHERE purchase_id = pu.id AND status = 'paid' AND refund_status IS NULL AND counted_at IS NOT NULL;

  -- The Package call closes ("Package started"), unless a part payment already closed it; the Pending payment call
  -- (open or not) closes too.
  FOR v_call IN SELECT id, kind, outcome FROM public.calls
                WHERE purchase_id = pu.id AND kind IN ('package', 'pending_payment') ORDER BY kind LOOP
    IF v_call.kind = 'package' AND v_call.outcome = 'part_paid' THEN
      CONTINUE;
    END IF;
    UPDATE public.calls SET status = 'closed', outcome = 'package_started', closed_at = v_at WHERE id = v_call.id;
    INSERT INTO public.call_logs (call_id, at, entry, event, note, by_profile_id, by_name)
    VALUES (v_call.id, v_at, 'event', 'package_started',
            'Paid ' || public.rupees_text(b.paid_paise) || ' of ' || public.rupees_text(b.total_paise) || ' · with CRM', p_by, p_by_name);
  END LOOP;

  -- Journey of the assessment purchase: Package call actual = the time the package started.
  UPDATE public.purchase_stages SET done_at = v_at WHERE purchase_id = pu.id AND stage = 'package_call';
  PERFORM public.purchase_refresh(pu.id);
  RETURN v_new;
END;
$$;

-- 4. A part payment: Package call done, Pending payment call starts -------------------------------------------

-- Same as 20261124000000, except the part payment below the start amount: the Package call closes ("Part payment
-- received") and the Pending payment call is made (or reopened), due at the payment's follow-up.
CREATE OR REPLACE FUNCTION public.package_settle(p_payment uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pp public.package_payments;
  pu public.purchases;
  c public.calls;
  pc public.calls;
  v_total integer;
  v_paid integer;
  v_start integer;
  v_pkg uuid;
  v_due timestamptz;
  v_new uuid;
BEGIN
  SELECT * INTO pp FROM public.package_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND OR pp.status <> 'paid' THEN
    RAISE EXCEPTION 'This package payment is not paid.';
  END IF;
  IF pp.refund_status IS NOT NULL THEN
    RETURN 'duplicate';
  END IF;
  IF pp.counted_at IS NOT NULL THEN
    RETURN 'paid';
  END IF;
  -- One at a time per assessment purchase.
  SELECT * INTO pu FROM public.purchases WHERE id = pp.purchase_id FOR UPDATE;

  -- The package amount is fixed by the first payment that counted; this payment's own copy when it is the first.
  SELECT x.price_paise - x.advance_paise INTO v_total FROM public.package_payments x
  WHERE x.purchase_id = pu.id AND x.status = 'paid' AND x.refund_status IS NULL AND x.counted_at IS NOT NULL
  ORDER BY x.counted_at, x.created_at, x.id LIMIT 1;
  v_total := coalesce(v_total, pp.price_paise - pp.advance_paise);
  SELECT coalesce(sum(x.amount_paise), 0) INTO v_paid FROM public.package_payments x
  WHERE x.purchase_id = pu.id AND x.status = 'paid' AND x.refund_status IS NULL AND x.counted_at IS NOT NULL;
  SELECT id INTO v_pkg FROM public.purchases WHERE parent_purchase_id = pu.id AND kind = 'package' AND status = 'paid';
  SELECT * INTO c FROM public.calls WHERE purchase_id = pu.id AND kind = 'package' FOR UPDATE;

  IF v_paid + pp.amount_paise > v_total THEN
    -- More than the remaining balance: it counts for nothing and is kept apart for a refund.
    UPDATE public.package_payments SET refund_status = 'needed', after_handover = (v_pkg IS NOT NULL) WHERE id = pp.id;
    IF c.id IS NOT NULL AND v_pkg IS NULL THEN
      INSERT INTO public.call_logs (call_id, entry, event, note)
      VALUES (c.id, 'event', 'package_refund_needed',
              public.rupees_text(pp.amount_paise) || ' · more than the remaining ' || public.rupees_text(v_total - v_paid));
    END IF;
    RETURN 'duplicate';
  END IF;

  v_paid := v_paid + pp.amount_paise;
  UPDATE public.package_payments
  SET counted_at = clock_timestamp(), after_handover = (v_pkg IS NOT NULL), package_purchase_id = v_pkg
  WHERE id = pp.id;

  IF v_pkg IS NOT NULL THEN
    -- Already with CRM: the payment belongs to the package. Nothing changes for the coordinator.
    RETURN 'paid';
  END IF;

  v_start := least(coalesce((SELECT start_paise FROM public.packages WHERE is_active), v_total), v_total);
  IF v_paid >= v_start THEN
    PERFORM public.package_start_if_due(pu.id, pp.paid_at, pp.recorded_by, pp.recorded_by_name);
    RETURN 'paid';
  END IF;

  -- A part payment below the start amount: the Package call is done ("Part payment received") ...
  IF c.id IS NOT NULL THEN
    INSERT INTO public.call_logs (call_id, entry, event, note, by_profile_id, by_name)
    VALUES (c.id, 'event', 'package_part_paid',
            public.rupees_text(pp.amount_paise) || ' · paid ' || public.rupees_text(v_paid) || ' of ' || public.rupees_text(v_start) || ' to start',
            pp.recorded_by, pp.recorded_by_name);
    IF c.status = 'open' OR c.outcome IN ('done', 'not_interested') THEN
      UPDATE public.calls SET status = 'closed', outcome = 'part_paid', closed_at = now() WHERE id = c.id;
    END IF;
  END IF;

  -- ... and the Pending payment call starts, due at the follow-up booked with the client.
  v_due := coalesce(pp.follow_up_at, public.add_working_hours(now(), 2));
  INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
  VALUES (pu.id, 'pending_payment', now(), v_due)
  ON CONFLICT (purchase_id, kind) DO NOTHING
  RETURNING id INTO v_new;
  IF v_new IS NOT NULL THEN
    INSERT INTO public.call_logs (call_id, entry, event, note, by_profile_id, by_name)
    VALUES (v_new, 'event', 'created',
            'Paid ' || public.rupees_text(v_paid) || ' of ' || public.rupees_text(v_start) || ' · ' || public.rupees_text(v_start - v_paid) || ' pending',
            pp.recorded_by, pp.recorded_by_name);
  ELSE
    SELECT * INTO pc FROM public.calls WHERE purchase_id = pu.id AND kind = 'pending_payment' FOR UPDATE;
    IF pc.status = 'closed' THEN
      UPDATE public.calls SET status = 'open', outcome = NULL, closed_at = NULL, due_at = v_due WHERE id = pc.id;
      INSERT INTO public.call_logs (call_id, entry, event) VALUES (pc.id, 'event', 'reopened');
    ELSIF pp.follow_up_at IS NOT NULL THEN
      UPDATE public.calls SET due_at = v_due WHERE id = pc.id;
    END IF;
  END IF;
  PERFORM public.purchase_refresh(pu.id);
  RETURN 'paid';
END;
$$;

-- 5. Add package payment: the follow-up, and the start amount in at most 2 payments ----------------------------

CREATE OR REPLACE FUNCTION public.package_payment_add(
  p_id uuid, p_purchase uuid, p_by uuid, p_amount integer, p_method text, p_reference text, p_note text, p_paid_at timestamptz,
  p_proof_file_id text, p_proof_url text, p_follow_up timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  b record;
  v_role text;
  v_name text;
  v_min integer;
  v_ready boolean;
  v_follow_up timestamptz := p_follow_up;
  v_reference text := btrim(regexp_replace(coalesce(p_reference, ''), '\s+', ' ', 'g'));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  SELECT role, full_name INTO v_role, v_name FROM public.profiles WHERE id = p_by AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'coordinator', 'crm') THEN
    RAISE EXCEPTION 'Only coordinators, CRM and super admins can add a package payment.';
  END IF;
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase AND kind = 'assessment' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This purchase was not found.';
  END IF;
  SELECT * INTO b FROM public.package_balance(p_purchase);
  v_ready := FOUND;
  IF v_role = 'coordinator' AND pu.coordinator_id IS DISTINCT FROM p_by THEN
    RAISE EXCEPTION 'Only this client''s coordinator can add their package payment.';
  END IF;
  IF v_role = 'crm' AND NOT EXISTS (SELECT 1 FROM public.purchases x
                                    WHERE x.parent_purchase_id = pu.id AND x.kind = 'package' AND x.status = 'paid' AND x.crm_id = p_by) THEN
    RAISE EXCEPTION 'Only this client''s CRM can add their package payment.';
  END IF;
  IF NOT v_ready THEN
    RAISE EXCEPTION 'A package payment can be added after the report presentation is done.';
  END IF;
  IF v_role = 'coordinator' AND b.started THEN
    RAISE EXCEPTION 'This package has started and is with CRM now.';
  END IF;
  IF b.remaining_paise <= 0 THEN
    RAISE EXCEPTION 'This package is already paid in full.';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount % 100 <> 0 THEN
    RAISE EXCEPTION 'Enter the amount in whole rupees.';
  END IF;
  IF p_amount > b.remaining_paise THEN
    RAISE EXCEPTION 'The amount is more than the remaining balance (%).', public.rupees_text(b.remaining_paise);
  END IF;
  IF b.paid_paise = 0 THEN
    v_min := least(b.first_min_paise, b.remaining_paise);
    IF p_amount < v_min THEN
      RAISE EXCEPTION 'The first payment must be at least %.', public.rupees_text(v_min);
    END IF;
  ELSIF NOT b.started AND b.paid_paise < b.start_paise THEN
    -- The start amount is paid in at most 2 payments: the second one makes up the rest of it.
    v_min := least(b.start_paise - b.paid_paise, b.remaining_paise);
    IF p_amount < v_min THEN
      RAISE EXCEPTION 'The second payment must be at least % (% in total to start sessions).', public.rupees_text(v_min), public.rupees_text(b.start_paise);
    END IF;
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('upi', 'bank_transfer', 'other') THEN
    RAISE EXCEPTION 'Choose how the client paid.';
  END IF;
  IF length(v_reference) < 1 OR length(v_reference) > 100 THEN
    RAISE EXCEPTION 'Enter the reference ID (UPI transaction ID, bank UTR or other).';
  END IF;
  IF length(v_note) > 500 THEN
    RAISE EXCEPTION 'The note can be at most 500 characters.';
  END IF;
  IF p_paid_at IS NULL OR p_paid_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'The payment date cannot be in the future.';
  END IF;
  IF p_proof_file_id IS NULL OR p_proof_url IS NULL THEN
    RAISE EXCEPTION 'Add the payment proof (screenshot or PDF).';
  END IF;
  -- Below the start amount after this payment: when to call the client about the rest (within 3 working days).
  IF NOT b.started AND b.paid_paise + p_amount < b.start_paise THEN
    IF v_follow_up IS NULL OR v_follow_up <= now() OR v_follow_up > public.pending_follow_up_last(now()) THEN
      RAISE EXCEPTION 'Pick when to call the client about the rest: within 3 working days.';
    END IF;
  ELSE
    v_follow_up := NULL;
  END IF;

  INSERT INTO public.package_payments (id, purchase_id, package_id, package_name, sessions, frequency, price_paise, advance_paise,
                                       amount_paise, phone, client_id, provider, status, provider_order_id, provider_payment_id,
                                       method, reference, note, paid_at, recorded_by, recorded_by_name, proof_file_id, proof_url, accounts_check,
                                       follow_up_at)
  VALUES (p_id, pu.id, b.package_id, b.name, b.sessions, b.frequency, b.price_paise, b.advance_paise,
          p_amount, pu.phone, pu.client_id, 'offline', 'paid', 'offline_' || p_id, 'offline_' || p_id,
          p_method, v_reference, v_note, p_paid_at, p_by, v_name, p_proof_file_id, p_proof_url, 'pending',
          v_follow_up);
  RETURN public.package_settle(p_id);
END;
$$;

-- The call from 20261124000000 (no follow-up): the same rules; a part payment below the start amount is refused
-- because it needs a follow-up. package_payment_manual() (the whole remaining balance) goes through here.
CREATE OR REPLACE FUNCTION public.package_payment_add(
  p_id uuid, p_purchase uuid, p_by uuid, p_amount integer, p_method text, p_reference text, p_note text, p_paid_at timestamptz,
  p_proof_file_id text, p_proof_url text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.package_payment_add(p_id, p_purchase, p_by, p_amount, p_method, p_reference, p_note, p_paid_at,
                                    p_proof_file_id, p_proof_url, NULL::timestamptz);
$$;

-- 6. Mark as call done: 3 working days on the Pending payment call -------------------------------------------

-- Same as 20261124000000, plus: the Pending payment call takes a follow-up within 3 working days, and its Not
-- interested is for super admins only (a package amount is always paid by then).
CREATE OR REPLACE FUNCTION public.call_mark(p_call uuid, p_by uuid, p_choice text, p_reason text, p_note text, p_follow_up timestamptz)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.calls;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text := p_reason;
  v_follow_up timestamptz := p_follow_up;
BEGIN
  SELECT * INTO c FROM public.calls WHERE id = p_call FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This call was not found.';
  END IF;
  IF c.status <> 'open' THEN
    RAISE EXCEPTION 'This call is already closed.';
  END IF;
  IF p_choice IS NULL OR p_choice NOT IN ('talked', 'not_picked', 'not_interested') THEN
    RAISE EXCEPTION 'Choose what happened on the call.';
  END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'The note is too long (2,000 characters at most).';
  END IF;

  IF p_choice IN ('talked', 'not_picked') THEN
    IF c.kind = 'pending_payment' THEN
      IF v_follow_up IS NULL OR v_follow_up <= now() OR v_follow_up > public.pending_follow_up_last(now()) THEN
        RAISE EXCEPTION 'Pick a follow-up date and time within 3 working days.';
      END IF;
    ELSIF v_follow_up IS NULL OR v_follow_up <= now() OR v_follow_up > public.add_working_hours(now(), 18) THEN
      RAISE EXCEPTION 'Pick a follow-up date and time within 2 working days.';
    END IF;
  ELSE
    v_follow_up := NULL;
  END IF;

  IF p_choice = 'not_interested' THEN
    IF c.kind IN ('package', 'pending_payment')
       AND EXISTS (SELECT 1 FROM public.package_payments pp
                   WHERE pp.purchase_id = c.purchase_id AND pp.status = 'paid' AND pp.refund_status IS NULL AND pp.counted_at IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
      RAISE EXCEPTION 'A package payment is already received. Only an admin can mark Not interested.';
    END IF;
    IF (SELECT count(*) FROM public.call_logs WHERE call_id = c.id AND entry = 'call') < 2 THEN
      RAISE EXCEPTION 'At least 2 calls are needed first.';
    END IF;
    IF v_reason IS NULL OR v_reason NOT IN ('too_costly', 'not_now', 'wrong_number', 'other') THEN
      RAISE EXCEPTION 'Choose a reason.';
    END IF;
  ELSE
    v_reason := NULL;
  END IF;

  INSERT INTO public.call_logs (call_id, entry, choice, reason, note, follow_up_at, by_profile_id, by_name)
  VALUES (c.id, 'call', p_choice, v_reason, v_note, v_follow_up, p_by,
          (SELECT full_name FROM public.profiles WHERE id = p_by));

  IF p_choice IN ('talked', 'not_picked') THEN
    UPDATE public.calls SET due_at = v_follow_up WHERE id = c.id;
  ELSE
    UPDATE public.calls SET status = 'closed', outcome = 'not_interested', closed_at = now() WHERE id = c.id;
    IF c.kind = 'payment' THEN
      UPDATE public.purchases SET closed_at = now(), closed_reason = 'not_interested'
      WHERE id = c.purchase_id AND status = 'not_paid' AND closed_at IS NULL;
    END IF;
  END IF;
END;
$$;

-- 7. Open purchase: a Pending payment call closed as Not interested finishes it, like the Package call ----------

CREATE OR REPLACE FUNCTION public.purchase_is_open(p public.purchases)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id IS NOT NULL AND p.kind = 'assessment' AND p.status = 'paid'
    AND NOT EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = p.id AND x.kind = 'package' AND x.status = 'paid')
    AND NOT EXISTS (SELECT 1 FROM public.calls c
                    WHERE c.purchase_id = p.id AND c.kind IN ('assessment', 'booking', 'package', 'pending_payment')
                      AND c.status = 'closed' AND c.outcome = 'not_interested');
$$;
COMMENT ON FUNCTION public.purchase_is_open(public.purchases) IS 'Open purchase: Paid assessment purchase, no package paid for it, no Assessment / Booking / Package / Pending payment call closed as Not interested. Refunded and cancelled purchases have another status.';

-- 8. Packages already part paid get the new flow once ---------------------------------------------------------

DO $$
DECLARE
  r record;
  v_new uuid;
BEGIN
  FOR r IN
    SELECT pu.id, b.paid_paise, b.start_paise
    FROM public.purchases pu CROSS JOIN LATERAL public.package_balance(pu.id) b
    WHERE pu.kind = 'assessment' AND NOT b.started AND b.paid_paise > 0 AND b.paid_paise < b.start_paise
  LOOP
    UPDATE public.calls SET status = 'closed', outcome = 'part_paid', closed_at = now()
    WHERE purchase_id = r.id AND kind = 'package' AND (status = 'open' OR outcome IN ('done', 'not_interested'));
    INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
    VALUES (r.id, 'pending_payment', now(), public.add_working_hours(now(), 2))
    ON CONFLICT (purchase_id, kind) DO NOTHING
    RETURNING id INTO v_new;
    IF v_new IS NOT NULL THEN
      INSERT INTO public.call_logs (call_id, entry, event, note)
      VALUES (v_new, 'event', 'created',
              'Paid ' || public.rupees_text(r.paid_paise) || ' of ' || public.rupees_text(r.start_paise) || ' · '
              || public.rupees_text(r.start_paise - r.paid_paise) || ' pending');
    END IF;
    PERFORM public.purchase_refresh(r.id);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.pending_follow_up_last(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_start_if_due(uuid, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_settle(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchase_is_open(public.purchases) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_follow_up_last(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) TO service_role;

COMMIT;

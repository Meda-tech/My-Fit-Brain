-- Package part payments, handover to CRM, CRM role (owner, 2026-11-24).
-- Run after 20261123400000_call_choices.sql.
--
-- REMOVES NOTHING. No DELETE, no DROP of a table, column or row, no TRUNCATE. No existing access rule is dropped or
-- changed: new rules are added next to them. The payments table (the ₹3,500 assessment payments) is NOT touched.
--
-- Allowed-values lists (CHECK rules) replaced by WIDER ones (owner's standing permission, 2026-11-20; no row is
-- changed or removed by them):
--   profiles.role + 'crm' · calls.outcome + 'package_started' · call_logs.event + 'package_part_paid',
--   'package_started' · package_payments amount rule: a part amount is allowed (before: only the full amount).
--
-- Existing rows changed (new columns filled only): package_payments.counted_at for payments that already made a
-- package; purchases.crm_id for existing Package purchases when an active CRM exists.
--
-- In plain words:
--   1. Package amounts (Settings, never hard-coded): first payment minimum ₹1,000, start amount ₹10,000 (paid in
--      total to hand over to CRM), milestones (paid in total before a session: ₹10,000 / 1, ₹15,000 / 2, ₹25,000 / 3,
--      ₹31,500 / 4). Milestones are stored and shown only.
--   2. A package can be paid in parts. The package amount (price − assessment amount paid) is fixed by the first
--      payment that counts. A payment counts when it fits into the remaining balance; one that is more than the
--      remaining balance is refused (manual) or, if it still arrives (Razorpay), kept apart as "Refund needed".
--   3. While paid in total is below the start amount the Package call stays open (a history line per payment; a call
--      closed as Not interested reopens). When it reaches the start amount: the Package purchase is made ("Started –
--      with CRM"), the Package call closes ("Package started") and the client gets a CRM person.
--   4. Once any package amount is paid, only a super admin can mark the Package call Not interested.
--   5. The client app is not changed: its offer is the full amount by Razorpay, and exists only while nothing is paid
--      yet. A full payment there is paid in full and handed over the same way.
--   6. CRM role: one CRM per client (phone): round robin for a new client, the same CRM for a returning one; Move
--      clients (logged) before Make inactive. A package that starts while no CRM is active waits and is assigned when
--      a CRM becomes active.
--   7. Who sees what, in the database:
--      * CRM: only through crm_packages() (client name, phone, package, paid, remaining, next milestone) and the
--        package payments of their own clients. New RESTRICTIVE rules close clients, assessments, answers, results,
--        client details, conclusions, safety alerts and questionnaire versions for a CRM login.
--      * Coordinator: Package purchases and package payments made after the handover are hidden (new RESTRICTIVE
--        rules). Everything else as before.
--
-- Checks: docs/tasks/37-package-part-payments-crm-verify.sql ·
-- behaviour test supabase/staging/staging-test-package-part-payments.sql

BEGIN;

-- 1. Wider allowed values ------------------------------------------------------------------------------------

ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'coordinator', 'counsellor', 'crm'));

ALTER TABLE public.calls DROP CONSTRAINT calls_outcome_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended', 'before_go_live', 'booked', 'package_paid',
                     'not_needed', 'package_started'));

ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_event_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_event_check
  CHECK (event IN ('created', 'new_try', 'try_failed', 'paid', 'assessment_completed', 'ended', 'reopened',
                   'presentation_booked', 'booking_cancelled',
                   'package_paid', 'package_payment_failed', 'package_payment_not_completed', 'package_refund_needed',
                   'not_needed', 'package_part_paid', 'package_started'));

ALTER TABLE public.package_payments DROP CONSTRAINT package_payments_amount;
ALTER TABLE public.package_payments ADD CONSTRAINT package_payments_amount
  CHECK (amount_paise > 0 AND amount_paise <= price_paise - advance_paise);

-- 2. Package amounts (settings) ------------------------------------------------------------------------------

ALTER TABLE public.packages ADD COLUMN first_min_paise integer NOT NULL DEFAULT 100000 CHECK (first_min_paise > 0);
ALTER TABLE public.packages ADD COLUMN start_paise integer NOT NULL DEFAULT 1000000 CHECK (start_paise > 0);
ALTER TABLE public.packages ADD COLUMN milestones jsonb NOT NULL DEFAULT
  '[{"session":1,"paid_paise":1000000},{"session":2,"paid_paise":1500000},{"session":3,"paid_paise":2500000},{"session":4,"paid_paise":3150000}]'::jsonb;
ALTER TABLE public.packages ADD CONSTRAINT packages_first_min_start CHECK (first_min_paise <= start_paise);
COMMENT ON COLUMN public.packages.first_min_paise IS 'The smallest first package payment (booking amount). Later payments: any amount up to the remaining balance.';
COMMENT ON COLUMN public.packages.start_paise IS 'Paid in total to start: the Package purchase is made and handed over to CRM.';
COMMENT ON COLUMN public.packages.milestones IS 'Paid in total before a session: [{"session": 1, "paid_paise": 1000000}, …]. Stored and shown only (enforced later, in the CRM phase).';

-- 3. New columns ---------------------------------------------------------------------------------------------

ALTER TABLE public.package_payments ADD COLUMN counted_at timestamptz;
ALTER TABLE public.package_payments ADD COLUMN after_handover boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.package_payments.counted_at IS 'When this paid payment was counted towards the package (it fitted into the remaining balance). Empty: not paid, or kept apart for a refund.';
COMMENT ON COLUMN public.package_payments.after_handover IS 'Paid after the package was handed over to CRM. Coordinators do not see these.';
COMMENT ON TABLE public.package_payments IS 'Package payments: Razorpay tries (created / paid / failed) and manual payments (offline, with proof). A package can be paid in parts: amount_paise is this payment; price_paise − advance_paise is the whole package amount, fixed by the first payment that counts. Never deleted.';
-- Payments that already made a package count.
UPDATE public.package_payments SET counted_at = coalesce(paid_at, updated_at)
WHERE status = 'paid' AND refund_status IS NULL AND package_purchase_id IS NOT NULL AND counted_at IS NULL;
CREATE INDEX package_payments_package_idx ON public.package_payments (package_purchase_id) WHERE package_purchase_id IS NOT NULL;

ALTER TABLE public.purchases ADD COLUMN crm_id uuid REFERENCES public.profiles(id);
COMMENT ON COLUMN public.purchases.crm_id IS 'Package purchases only: the client''s CRM person (client_crms). Empty while no CRM is active.';
ALTER TABLE public.purchases ADD CONSTRAINT purchases_crm_only_package CHECK (crm_id IS NULL OR kind = 'package');
CREATE INDEX purchases_crm_idx ON public.purchases (crm_id) WHERE kind = 'package';
COMMENT ON TABLE public.purchases IS 'kind assessment: a purchase (paid, refunded, cancelled) or a payment attempt (not_paid), with its journey. kind package: a package that has started (paid in total reached the start amount), handed over to CRM (crm_id), linked to its assessment purchase (parent_purchase_id); amount_paise is the whole package amount, its payments are in package_payments.';

-- 4. CRM of a client -----------------------------------------------------------------------------------------

CREATE TABLE public.crm_round_robin (
  profile_id        uuid PRIMARY KEY REFERENCES public.profiles(id),
  last_assigned_at  timestamptz NOT NULL
);
COMMENT ON TABLE public.crm_round_robin IS 'When each CRM last got a new client. The next new client goes to the active CRM who waited longest.';

CREATE TABLE public.client_crms (
  phone        text PRIMARY KEY,
  crm_id       uuid REFERENCES public.profiles(id),   -- empty = no active CRM at the time
  assigned_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.client_crms IS 'The CRM person of a client (one phone number, E.164), from the first package that starts. Every Package purchase of the phone shows this CRM.';
CREATE INDEX client_crms_crm_idx ON public.client_crms (crm_id);

CREATE TABLE public.crm_client_moves (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_crm_id    uuid NOT NULL REFERENCES public.profiles(id),
  to_crm_id      uuid NOT NULL REFERENCES public.profiles(id),
  phones         text[] NOT NULL,
  clients_moved  integer NOT NULL,
  moved_by       uuid REFERENCES public.profiles(id),
  moved_by_name  text,
  moved_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.crm_client_moves IS 'Each time a super admin moved all clients of one CRM to another. Never changed or removed.';

CREATE OR REPLACE FUNCTION public.crm_client_moves_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Moves are never changed or removed.';
END;
$$;
CREATE TRIGGER crm_client_moves_keep BEFORE UPDATE OR DELETE ON public.crm_client_moves
  FOR EACH ROW EXECUTE FUNCTION public.crm_client_moves_keep_trigger();

ALTER TABLE public.crm_round_robin ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_round_robin_select ON public.crm_round_robin FOR SELECT TO authenticated USING (public.is_super_admin());
ALTER TABLE public.client_crms ENABLE ROW LEVEL SECURITY;
CREATE POLICY client_crms_select ON public.client_crms FOR SELECT TO authenticated
  USING (public.is_super_admin() OR crm_id = public.get_current_staff_profile_id());
ALTER TABLE public.crm_client_moves ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_client_moves_select ON public.crm_client_moves FOR SELECT TO authenticated USING (public.is_super_admin());

-- The client's CRM for a phone: the one already assigned while still active, else the active CRM who waited
-- longest for a new client (round robin). Empty when no CRM is active.
CREATE OR REPLACE FUNCTION public.client_crm(p_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-round-robin', 0));
  SELECT c.crm_id INTO v FROM public.client_crms c WHERE c.phone = p_phone;
  IF v IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE id = v AND role = 'crm' AND is_active) THEN
    RETURN v;
  END IF;

  SELECT p.id INTO v
  FROM public.profiles p
  LEFT JOIN public.crm_round_robin r ON r.profile_id = p.id
  WHERE p.role = 'crm' AND p.is_active
  ORDER BY r.last_assigned_at NULLS FIRST, p.created_at, p.id
  LIMIT 1;

  INSERT INTO public.client_crms (phone, crm_id, assigned_at) VALUES (p_phone, v, now())
  ON CONFLICT (phone) DO UPDATE SET crm_id = EXCLUDED.crm_id, assigned_at = EXCLUDED.assigned_at;
  IF v IS NOT NULL THEN
    INSERT INTO public.crm_round_robin (profile_id, last_assigned_at) VALUES (v, clock_timestamp())
    ON CONFLICT (profile_id) DO UPDATE SET last_assigned_at = EXCLUDED.last_assigned_at;
  END IF;
  RETURN v;
END;
$$;

-- Packages that started while no CRM was active get their CRM now (oldest first). Returns how many clients.
CREATE OR REPLACE FUNCTION public.crm_assign_waiting()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v uuid;
  n integer := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'crm' AND is_active) THEN
    RETURN 0;
  END IF;
  FOR r IN SELECT k.phone, min(k.paid_at) AS first_at FROM public.purchases k
           WHERE k.kind = 'package' AND k.crm_id IS NULL GROUP BY k.phone ORDER BY 2, 1 LOOP
    v := public.client_crm(r.phone);
    UPDATE public.purchases SET crm_id = v WHERE kind = 'package' AND phone = r.phone AND crm_id IS NULL;
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION public.profiles_crm_assign_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.crm_assign_waiting();
  RETURN NULL;
END;
$$;
CREATE TRIGGER profiles_crm_assign AFTER INSERT OR UPDATE OF is_active, role ON public.profiles
  FOR EACH ROW WHEN (NEW.role = 'crm' AND NEW.is_active) EXECUTE FUNCTION public.profiles_crm_assign_trigger();

-- Moves every client (phone) of p_from, with their Package purchases, to p_to. Returns how many clients moved.
CREATE OR REPLACE FUNCTION public.move_crm_clients(p_from uuid, p_to uuid, p_by uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phones text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'Only super admins can move clients.';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_from AND role = 'crm') THEN
    RAISE EXCEPTION 'Choose another CRM.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND role = 'crm' AND is_active) THEN
    RAISE EXCEPTION 'The new CRM must be an active CRM.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('crm-round-robin', 0));

  WITH moved AS (
    UPDATE public.client_crms SET crm_id = p_to, assigned_at = now()
    WHERE crm_id = p_from
    RETURNING phone
  )
  SELECT coalesce(array_agg(phone ORDER BY phone), '{}') INTO v_phones FROM moved;

  UPDATE public.purchases SET crm_id = p_to
  WHERE kind = 'package' AND (crm_id = p_from OR phone = ANY (v_phones));

  INSERT INTO public.crm_client_moves (from_crm_id, to_crm_id, phones, clients_moved, moved_by, moved_by_name)
  VALUES (p_from, p_to, v_phones, cardinality(v_phones), p_by, (SELECT full_name FROM public.profiles WHERE id = p_by));
  RETURN cardinality(v_phones);
END;
$$;

-- No "Make inactive" while a CRM still has clients.
CREATE OR REPLACE FUNCTION public.profiles_keep_crm_clients_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.role = 'crm' AND OLD.is_active AND NOT NEW.is_active
     AND (EXISTS (SELECT 1 FROM public.client_crms WHERE crm_id = OLD.id)
          OR EXISTS (SELECT 1 FROM public.purchases WHERE crm_id = OLD.id)) THEN
    RAISE EXCEPTION 'Move their clients first.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER profiles_keep_crm_clients BEFORE UPDATE OF is_active ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_keep_crm_clients_trigger();

-- 5. Balance, offer, milestones ------------------------------------------------------------------------------

-- "₹31,500" (whole rupees).
CREATE OR REPLACE FUNCTION public.rupees_text(p_paise integer)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT '₹' || to_char(p_paise / 100, 'FM999,999,990');
$$;

-- The package of an assessment purchase, or no row: paid and report presentation done. The package amount (total)
-- is fixed by the first payment that counts; before that it comes from the active package. The first minimum and the
-- start amount come from the settings (never more than the total).
CREATE OR REPLACE FUNCTION public.package_balance(p_purchase uuid)
RETURNS TABLE (package_id uuid, name text, sessions integer, frequency text, price_paise integer, advance_paise integer,
               total_paise integer, paid_paise integer, remaining_paise integer, first_min_paise integer, start_paise integer,
               started boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pu AS (
    SELECT p.id, p.amount_paise FROM public.purchases p
    WHERE p.id = p_purchase AND p.kind = 'assessment' AND p.status = 'paid'
      AND EXISTS (SELECT 1 FROM public.presentation_bookings b WHERE b.purchase_id = p.id AND b.status = 'booked' AND b.done_at IS NOT NULL)
  ), first_pay AS (
    SELECT pp.package_id, pp.package_name, pp.sessions, pp.frequency, pp.price_paise, pp.advance_paise
    FROM public.package_payments pp
    WHERE pp.purchase_id = p_purchase AND pp.status = 'paid' AND pp.refund_status IS NULL AND pp.counted_at IS NOT NULL
    ORDER BY pp.counted_at, pp.created_at, pp.id LIMIT 1
  ), terms AS (
    SELECT f.package_id, f.package_name AS name, f.sessions, f.frequency, f.price_paise, f.advance_paise FROM first_pay f
    UNION ALL
    SELECT k.id, k.name, k.sessions, k.frequency, k.price_paise, pu.amount_paise
    FROM public.packages k CROSS JOIN pu
    WHERE k.is_active AND k.price_paise - pu.amount_paise > 0 AND NOT EXISTS (SELECT 1 FROM first_pay)
  ), paid AS (
    SELECT coalesce(sum(pp.amount_paise), 0)::integer AS paise FROM public.package_payments pp
    WHERE pp.purchase_id = p_purchase AND pp.status = 'paid' AND pp.refund_status IS NULL AND pp.counted_at IS NOT NULL
  ), s AS (
    SELECT (SELECT k.first_min_paise FROM public.packages k WHERE k.is_active) AS first_min,
           (SELECT k.start_paise FROM public.packages k WHERE k.is_active) AS start
  )
  SELECT t.package_id, t.name, t.sessions, t.frequency, t.price_paise, t.advance_paise,
         t.price_paise - t.advance_paise, paid.paise, t.price_paise - t.advance_paise - paid.paise,
         least(coalesce(s.first_min, 1), t.price_paise - t.advance_paise),
         least(coalesce(s.start, t.price_paise - t.advance_paise), t.price_paise - t.advance_paise),
         EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = p_purchase AND x.kind = 'package' AND x.status = 'paid')
  FROM pu CROSS JOIN terms t CROSS JOIN paid CROSS JOIN s;
$$;

-- The offer in the client app (unchanged for the client: the full amount by Razorpay). It exists while nothing is
-- paid for the package yet: once a part payment is counted, the rest is collected by the team.
CREATE OR REPLACE FUNCTION public.package_offer(p_purchase uuid)
RETURNS TABLE (package_id uuid, name text, sessions integer, frequency text, price_paise integer, advance_paise integer, amount_paise integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.package_id, b.name, b.sessions, b.frequency, b.price_paise, b.advance_paise, b.total_paise
  FROM public.package_balance(p_purchase) b
  WHERE b.paid_paise = 0 AND NOT b.started;
$$;

-- The next milestone for an amount paid in total, or no row when the package is paid in full. session is empty for
-- "the rest" (paid past the last milestone but not in full).
CREATE OR REPLACE FUNCTION public.package_next_milestone(p_paid integer, p_total integer)
RETURNS TABLE (session integer, paid_paise integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH m AS (
    SELECT (e->>'session')::integer AS session, least((e->>'paid_paise')::integer, p_total) AS paid_paise
    FROM public.packages k CROSS JOIN LATERAL jsonb_array_elements(k.milestones) e
    WHERE k.is_active
  ), nxt AS (
    SELECT m.session, m.paid_paise FROM m WHERE m.paid_paise > p_paid ORDER BY m.paid_paise, m.session LIMIT 1
  )
  SELECT session, paid_paise FROM nxt
  UNION ALL
  SELECT NULL::integer, p_total WHERE p_paid < p_total AND NOT EXISTS (SELECT 1 FROM nxt);
$$;

-- 6. Settling a paid payment ---------------------------------------------------------------------------------

-- The handover: when the amount paid in total has reached the start amount and no package was started yet, the
-- Package purchase is made ("Started – with CRM"), the client gets a CRM, the counted payments are linked to it and
-- the Package call closes ("Package started"). Returns the Package purchase, or empty when it is not due.
CREATE OR REPLACE FUNCTION public.package_start_if_due(p_purchase uuid, p_at timestamptz, p_by uuid, p_by_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  b record;
  v_new uuid;
  v_call uuid;
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

  -- The Package call closes ("Package started"), whatever its state was.
  SELECT id INTO v_call FROM public.calls WHERE purchase_id = pu.id AND kind = 'package';
  IF v_call IS NOT NULL THEN
    UPDATE public.calls SET status = 'closed', outcome = 'package_started', closed_at = v_at WHERE id = v_call;
    INSERT INTO public.call_logs (call_id, at, entry, event, note, by_profile_id, by_name)
    VALUES (v_call, v_at, 'event', 'package_started',
            'Paid ' || public.rupees_text(b.paid_paise) || ' of ' || public.rupees_text(b.total_paise) || ' · with CRM', p_by, p_by_name);
  END IF;

  -- Journey of the assessment purchase: Package call actual = the time the package started.
  UPDATE public.purchase_stages SET done_at = v_at WHERE purchase_id = pu.id AND stage = 'package_call';
  PERFORM public.purchase_refresh(pu.id);
  RETURN v_new;
END;
$$;

-- A paid package payment is counted towards the package. Returns 'paid', or 'duplicate' when it is more than the
-- remaining balance (then it is kept apart for a refund and counts for nothing). Safe to call again.
CREATE OR REPLACE FUNCTION public.package_settle(p_payment uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pp public.package_payments;
  pu public.purchases;
  c public.calls;
  v_total integer;
  v_paid integer;
  v_start integer;
  v_pkg uuid;
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

  -- A part payment below the start amount: the Package call stays open, with a history line.
  IF c.id IS NOT NULL THEN
    INSERT INTO public.call_logs (call_id, entry, event, note, by_profile_id, by_name)
    VALUES (c.id, 'event', 'package_part_paid',
            public.rupees_text(pp.amount_paise) || ' · paid ' || public.rupees_text(v_paid) || ' of ' || public.rupees_text(v_start) || ' to start',
            pp.recorded_by, pp.recorded_by_name);
    IF c.status = 'closed' AND c.outcome IN ('done', 'not_interested') THEN
      UPDATE public.calls SET status = 'open', outcome = NULL, closed_at = NULL, due_at = public.add_working_hours(now(), 2) WHERE id = c.id;
      INSERT INTO public.call_logs (call_id, entry, event) VALUES (c.id, 'event', 'reopened');
    END IF;
  END IF;
  RETURN 'paid';
END;
$$;

-- 7. Manual package payment, in parts ------------------------------------------------------------------------

-- "Add package payment": coordinators for their own clients until the package starts; after that the client's CRM;
-- super admins always. First payment at least the first minimum; never more than the remaining balance.
CREATE OR REPLACE FUNCTION public.package_payment_add(
  p_id uuid, p_purchase uuid, p_by uuid, p_amount integer, p_method text, p_reference text, p_note text, p_paid_at timestamptz,
  p_proof_file_id text, p_proof_url text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  b record;
  v_role text;
  v_name text;
  v_min integer;
  v_ready boolean;
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
  v_min := least(b.first_min_paise, b.remaining_paise);
  IF b.paid_paise = 0 AND p_amount < v_min THEN
    RAISE EXCEPTION 'The first payment must be at least %.', public.rupees_text(v_min);
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

  INSERT INTO public.package_payments (id, purchase_id, package_id, package_name, sessions, frequency, price_paise, advance_paise,
                                       amount_paise, phone, client_id, provider, status, provider_order_id, provider_payment_id,
                                       method, reference, note, paid_at, recorded_by, recorded_by_name, proof_file_id, proof_url, accounts_check)
  VALUES (p_id, pu.id, b.package_id, b.name, b.sessions, b.frequency, b.price_paise, b.advance_paise,
          p_amount, pu.phone, pu.client_id, 'offline', 'paid', 'offline_' || p_id, 'offline_' || p_id,
          p_method, v_reference, v_note, p_paid_at, p_by, v_name, p_proof_file_id, p_proof_url, 'pending');
  RETURN public.package_settle(p_id);
END;
$$;

-- The older call without an amount: the whole remaining balance.
CREATE OR REPLACE FUNCTION public.package_payment_manual(
  p_id uuid, p_purchase uuid, p_by uuid, p_method text, p_reference text, p_note text, p_paid_at timestamptz,
  p_proof_file_id text, p_proof_url text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT remaining_paise INTO v_remaining FROM public.package_balance(p_purchase);
  RETURN public.package_payment_add(p_id, p_purchase, p_by, coalesce(v_remaining, 0), p_method, p_reference, p_note, p_paid_at,
                                    p_proof_file_id, p_proof_url);
END;
$$;

-- 8. Package amounts (super admins) --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.package_amounts_save(p_by uuid, p_first_min_paise integer, p_start_paise integer, p_milestones jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k public.packages;
  v_total integer;
  e jsonb;
  v_session integer;
  v_amount integer;
  v_last_session integer := 0;
  v_last_amount integer := 0;
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'Only super admins can change the package.';
  END IF;
  SELECT * INTO k FROM public.packages WHERE is_active FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The package is not set up yet.';
  END IF;
  -- The amount still owed after the ₹3,500 assessment (the same rule as package_save()).
  v_total := k.price_paise - 350000;
  IF p_first_min_paise IS NULL OR p_first_min_paise < 100 OR p_first_min_paise % 100 <> 0 THEN
    RAISE EXCEPTION 'Enter the first payment minimum in whole rupees.';
  END IF;
  IF p_start_paise IS NULL OR p_start_paise < p_first_min_paise OR p_start_paise % 100 <> 0 OR p_start_paise > v_total THEN
    RAISE EXCEPTION 'The start amount must be between the first payment minimum and the package amount.';
  END IF;
  IF p_milestones IS NULL OR jsonb_typeof(p_milestones) <> 'array' OR jsonb_array_length(p_milestones) > 20 THEN
    RAISE EXCEPTION 'Enter the milestones.';
  END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p_milestones) LOOP
    IF jsonb_typeof(e) <> 'object' OR jsonb_typeof(e->'session') IS DISTINCT FROM 'number' OR jsonb_typeof(e->'paid_paise') IS DISTINCT FROM 'number'
       OR (e->>'session') !~ '^\d{1,3}$' OR (e->>'paid_paise') !~ '^\d{1,9}$' THEN
      RAISE EXCEPTION 'Each milestone needs a session number and an amount in whole rupees.';
    END IF;
    v_session := (e->>'session')::integer;
    v_amount := (e->>'paid_paise')::integer;
    IF v_session < 1 OR v_session > k.sessions OR v_session <= v_last_session THEN
      RAISE EXCEPTION 'Milestone sessions must go up, from 1 to the number of sessions.';
    END IF;
    IF v_amount <= v_last_amount OR v_amount % 100 <> 0 OR v_amount > v_total THEN
      RAISE EXCEPTION 'Milestone amounts must go up and never be more than the package amount.';
    END IF;
    v_last_session := v_session;
    v_last_amount := v_amount;
  END LOOP;

  UPDATE public.packages
  SET first_min_paise = p_first_min_paise, start_paise = p_start_paise,
      milestones = (SELECT coalesce(jsonb_agg(jsonb_build_object('session', (x->>'session')::integer, 'paid_paise', (x->>'paid_paise')::integer)), '[]'::jsonb)
                    FROM jsonb_array_elements(p_milestones) x),
      updated_by = p_by
  WHERE id = k.id;

  -- A lower start amount: packages already paid up to it start now.
  FOR r IN SELECT DISTINCT pp.purchase_id FROM public.package_payments pp
           WHERE pp.status = 'paid' AND pp.refund_status IS NULL AND pp.counted_at IS NOT NULL AND pp.package_purchase_id IS NULL LOOP
    PERFORM public.package_start_if_due(r.purchase_id, now(), p_by, (SELECT full_name FROM public.profiles WHERE id = p_by));
  END LOOP;
END;
$$;

-- 9. Mark as call done: Not interested on a Package call with money received ---------------------------------

-- Same as 20261123400000, plus: once any package amount is paid, only a super admin can mark the Package call
-- Not interested.
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
    IF v_follow_up IS NULL OR v_follow_up <= now() OR v_follow_up > public.add_working_hours(now(), 18) THEN
      RAISE EXCEPTION 'Pick a follow-up date and time within 2 working days.';
    END IF;
  ELSE
    v_follow_up := NULL;
  END IF;

  IF p_choice = 'not_interested' THEN
    IF c.kind = 'package'
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

-- 10. Who sees what ------------------------------------------------------------------------------------------

-- The signed-in user's profile id when they are a CRM (active or not), else null.
CREATE OR REPLACE FUNCTION public.crm_login()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.profiles WHERE auth_user_id = (SELECT auth.uid()) AND role = 'crm' LIMIT 1;
$$;

-- The Package purchases of the signed-in CRM (none when inactive).
CREATE OR REPLACE FUNCTION public.crm_package_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id
  FROM public.purchases k
  JOIN public.profiles p ON p.id = k.crm_id
  WHERE p.auth_user_id = (SELECT auth.uid()) AND p.role = 'crm' AND p.is_active AND k.kind = 'package';
$$;

-- RESTRICTIVE: on top of the existing rules, they only narrow them.
-- A CRM login reads no client record, assessment, answer, result, client detail, conclusion, safety alert or
-- questionnaire version. (The client's name and phone come only from crm_packages().)
CREATE POLICY clients_not_crm ON public.clients AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);
CREATE POLICY attempts_not_crm ON public.attempts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);
CREATE POLICY attempt_answers_not_crm ON public.attempt_answers AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);
CREATE POLICY attempt_details_not_crm ON public.attempt_details AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);
CREATE POLICY attempt_results_not_crm ON public.attempt_results AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);
CREATE POLICY attempt_alerts_not_crm ON public.attempt_alerts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);
CREATE POLICY attempt_conclusions_not_crm ON public.attempt_conclusions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);
CREATE POLICY questionnaire_versions_not_crm ON public.questionnaire_versions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.crm_login()) IS NULL) WITH CHECK ((SELECT public.crm_login()) IS NULL);

-- Package purchases belong to CRM: only super admins read the rows (a coordinator keeps the assessment purchases of
-- their own clients; a CRM reads through crm_packages()).
CREATE POLICY purchases_packages_admin_only ON public.purchases AS RESTRICTIVE FOR SELECT TO authenticated
  USING (kind = 'assessment' OR (SELECT public.is_super_admin()));

-- Package payments: a CRM reads those of their own clients' packages; payments made after the handover are hidden
-- from everyone else but super admins (so a coordinator sees only what was collected before the handover).
CREATE POLICY package_payments_select_crm ON public.package_payments FOR SELECT TO authenticated
  USING (package_purchase_id IN (SELECT public.crm_package_ids()));
CREATE POLICY package_payments_after_handover ON public.package_payments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (NOT after_handover OR (SELECT public.is_super_admin()) OR package_purchase_id IN (SELECT public.crm_package_ids()));

-- The CRM dashboard: the Package purchases the signed-in user may see (a CRM their own clients', a super admin all),
-- with only what CRM needs: client name, phone, package, started on, paid so far, remaining, next milestone.
CREATE OR REPLACE FUNCTION public.crm_packages()
RETURNS TABLE (id uuid, parent_purchase_id uuid, client_name text, phone text, crm_id uuid, crm_name text,
               package_name text, sessions integer, frequency text, started_at timestamptz,
               total_paise integer, paid_paise integer, remaining_paise integer,
               next_session integer, next_paid_paise integer, milestones jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH me AS (
    SELECT p.id, p.role FROM public.profiles p
    WHERE p.auth_user_id = (SELECT auth.uid()) AND p.is_active AND p.role IN ('super_admin', 'crm')
    LIMIT 1
  ), k AS (
    SELECT pu.* FROM public.purchases pu, me
    WHERE pu.kind = 'package' AND pu.status = 'paid' AND (me.role = 'super_admin' OR pu.crm_id = me.id)
  ), paid AS (
    SELECT pp.package_purchase_id AS id, sum(pp.amount_paise)::integer AS paise,
           (array_agg(pp.package_name ORDER BY pp.counted_at, pp.created_at))[1] AS package_name,
           (array_agg(pp.sessions ORDER BY pp.counted_at, pp.created_at))[1] AS sessions,
           (array_agg(pp.frequency ORDER BY pp.counted_at, pp.created_at))[1] AS frequency
    FROM public.package_payments pp
    WHERE pp.status = 'paid' AND pp.refund_status IS NULL AND pp.counted_at IS NOT NULL
      AND pp.package_purchase_id IN (SELECT k.id FROM k)
    GROUP BY pp.package_purchase_id
  )
  SELECT k.id, k.parent_purchase_id,
         coalesce((SELECT c.full_name FROM public.clients c WHERE c.id = k.client_id),
                  (SELECT c.full_name FROM public.clients c WHERE right(c.phone, 10) = right(k.phone, 10) ORDER BY c.created_at LIMIT 1)),
         k.phone, k.crm_id, (SELECT p.full_name FROM public.profiles p WHERE p.id = k.crm_id),
         paid.package_name, paid.sessions, paid.frequency, k.paid_at,
         k.amount_paise, coalesce(paid.paise, 0), greatest(k.amount_paise - coalesce(paid.paise, 0), 0),
         n.session, n.paid_paise,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('session', (e->>'session')::integer,
                                                       'paid_paise', least((e->>'paid_paise')::integer, k.amount_paise))
                                    ORDER BY (e->>'paid_paise')::integer), '[]'::jsonb)
          FROM public.packages s CROSS JOIN LATERAL jsonb_array_elements(s.milestones) e WHERE s.is_active)
  FROM k
  LEFT JOIN paid ON paid.id = k.id
  LEFT JOIN LATERAL public.package_next_milestone(coalesce(paid.paise, 0), k.amount_paise) n ON true
  ORDER BY k.paid_at DESC, k.id;
$$;

-- 11. Who may call the functions -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.crm_client_moves_keep_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.client_crm(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.crm_assign_waiting() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_crm_assign_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_crm_clients(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.profiles_keep_crm_clients_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rupees_text(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_offer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_next_milestone(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_start_if_due(uuid, timestamptz, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_settle(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_manual(uuid, uuid, uuid, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_amounts_save(uuid, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.move_crm_clients(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_balance(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_offer(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_next_milestone(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_add(uuid, uuid, uuid, integer, text, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_manual(uuid, uuid, uuid, text, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_amounts_save(uuid, integer, integer, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) TO service_role;
-- The access functions run inside the rules, and crm_packages() checks the signed-in user itself.
REVOKE ALL ON FUNCTION public.crm_login() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_package_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_packages() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_login() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_package_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_packages() TO authenticated, service_role;

-- 12. Existing Package purchases get their CRM (when a CRM is active; else when the first one is added) ----------

SELECT public.crm_assign_waiting();

COMMIT;

-- Step 6 (owner, 2026-11-21): package offer and package payment.
-- Run after 20261121200000_presentation_done.sql.
--
-- REMOVES NO ROWS. The payments table (the ₹3,500 assessment payments) is NOT touched: package payments live in
-- their own table. Allowed-values lists (CHECK rules) replaced by WIDER ones (owner's standing permission):
--   purchases.kind + 'package' · calls.outcome + 'package_paid' · call_logs.choice + 'agreed' ·
--   call_logs.event + 'package_paid', 'package_payment_failed', 'package_payment_not_completed',
--   'package_refund_needed' · call_logs follow-up rule: 'agreed' needs a follow-up time too.
-- New tables packages and package_payments, a column on purchases, new functions; new bodies for call_mark() and
-- calls_sync().
--
-- In plain words:
--   1. packages: the one active package (name, sessions, frequency text, price), editable by super admins.
--      Seeded: 8 sessions, "1 session every week", ₹35,000.
--   2. Amount to pay = package price − the amount paid for that assessment purchase (₹35,000 − ₹3,500 = ₹31,500).
--      Always calculated here, never by a browser. Full payment only, no expiry.
--   3. The offer exists for an assessment purchase once its report presentation is marked done, until a package is
--      paid for it.
--   4. package_payments: every package payment try (Razorpay) and manual package payment (proof, reference,
--      "Accounts check: pending"), with a copy of the package as it was offered.
--   5. Paid (Razorpay or manual) → a new purchase of type Package (linked to the assessment purchase, same client and
--      coordinator); the Package call closes ("Package paid"); the journey's Package call actual = package paid time.
--      A second paid payment for the same assessment purchase makes no second package: it is flagged "refund needed".
--   6. A failed package payment, or one still not completed after 30 minutes, adds a line to the Package call's
--      history and reopens the call if it was closed (due 2 working hours later).
--   7. Package call choices: "Client agreed – will pay" (choice agreed: the call stays open, a follow-up within
--      2 working days is required), Call later / Not picked (follow-up), Not interested (after an earlier call, with
--      a reason). "Done" is no longer used on Package calls.
--
-- Checks: docs/tasks/27-packages-verify.sql

BEGIN;

-- 1. Wider allowed values ------------------------------------------------------------------------------------

ALTER TABLE public.purchases DROP CONSTRAINT purchases_kind_check;
ALTER TABLE public.purchases ADD CONSTRAINT purchases_kind_check CHECK (kind IN ('assessment', 'package'));

ALTER TABLE public.calls DROP CONSTRAINT calls_outcome_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_check
  CHECK (outcome IN ('done', 'not_interested', 'paid', 'assessment_completed', 'ended', 'before_go_live', 'booked', 'package_paid'));

ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_choice_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_choice_check
  CHECK (choice IN ('done', 'call_later', 'not_picked', 'not_interested', 'agreed'));
ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_follow_up;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_follow_up
  CHECK ((choice IN ('call_later', 'not_picked', 'agreed')) = (follow_up_at IS NOT NULL));
ALTER TABLE public.call_logs DROP CONSTRAINT call_logs_event_check;
ALTER TABLE public.call_logs ADD CONSTRAINT call_logs_event_check
  CHECK (event IN ('created', 'new_try', 'try_failed', 'paid', 'assessment_completed', 'ended', 'reopened',
                   'presentation_booked', 'booking_cancelled',
                   'package_paid', 'package_payment_failed', 'package_payment_not_completed', 'package_refund_needed'));

-- 2. The package (settings) ---------------------------------------------------------------------------------

CREATE TABLE public.packages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  sessions     integer NOT NULL CHECK (sessions BETWEEN 1 AND 100),
  frequency    text NOT NULL CHECK (length(btrim(frequency)) BETWEEN 2 AND 80),
  price_paise  integer NOT NULL CHECK (price_paise > 0),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES public.profiles(id)
);
COMMENT ON TABLE public.packages IS 'The package offered after the report presentation. One active row; super admins edit it (Settings). Every payment keeps a copy of the package as it was offered.';
CREATE UNIQUE INDEX packages_one_active ON public.packages (is_active) WHERE is_active;
CREATE TRIGGER packages_updated_at BEFORE UPDATE ON public.packages FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
INSERT INTO public.packages (name, sessions, frequency, price_paise) VALUES ('Counselling package', 8, '1 session every week', 3500000);

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY packages_select ON public.packages FOR SELECT TO authenticated USING (public.is_super_admin());

-- 3. Package purchases and package payments ------------------------------------------------------------------

ALTER TABLE public.purchases ADD COLUMN parent_purchase_id uuid REFERENCES public.purchases(id);
COMMENT ON COLUMN public.purchases.parent_purchase_id IS 'Package purchases only: the assessment purchase the package was bought for.';
ALTER TABLE public.purchases ADD CONSTRAINT purchases_package_has_parent CHECK ((kind = 'package') = (parent_purchase_id IS NOT NULL));
-- One paid package per assessment purchase: the database refuses a second one.
CREATE UNIQUE INDEX purchases_one_package_per_parent ON public.purchases (parent_purchase_id) WHERE kind = 'package' AND status = 'paid';
COMMENT ON TABLE public.purchases IS 'kind assessment: a purchase (paid, refunded, cancelled) or a payment attempt (not_paid), with its journey. kind package: a paid package, linked to its assessment purchase (parent_purchase_id); its payment is in package_payments.';

CREATE TABLE public.package_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id           uuid NOT NULL REFERENCES public.purchases(id),      -- the assessment purchase it is for
  package_purchase_id   uuid REFERENCES public.purchases(id),               -- the Package purchase it made
  package_id            uuid NOT NULL REFERENCES public.packages(id),
  -- The package as it was offered (settings can change later).
  package_name          text NOT NULL,
  sessions              integer NOT NULL,
  frequency             text NOT NULL,
  price_paise           integer NOT NULL,
  advance_paise         integer NOT NULL,
  amount_paise          integer NOT NULL,
  currency              text NOT NULL DEFAULT 'INR',
  phone                 text NOT NULL,
  client_id             uuid REFERENCES public.clients(id),
  provider              text NOT NULL DEFAULT 'razorpay' CHECK (provider IN ('razorpay', 'offline')),
  status                text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
  provider_order_id     text NOT NULL UNIQUE,
  provider_payment_id   text UNIQUE,
  method                text,
  failure_code          text,
  failure_reason        text,
  refund_status         text CHECK (refund_status IN ('needed', 'refunded')),
  paid_at               timestamptz,
  -- Manual payments (provider offline): the same details as a manual assessment payment.
  reference             text,
  note                  text,
  recorded_by           uuid REFERENCES public.profiles(id),
  recorded_by_name      text,
  proof_file_id         text,
  proof_url             text,
  accounts_check        text CHECK (accounts_check IN ('pending', 'checked')),
  -- When a failed / not completed try was written to the Package call's history.
  call_noted_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_payments_amount CHECK (amount_paise = price_paise - advance_paise AND amount_paise > 0),
  CONSTRAINT package_payments_paid CHECK (status <> 'paid' OR (provider_payment_id IS NOT NULL AND paid_at IS NOT NULL)),
  CONSTRAINT package_payments_refund CHECK (refund_status IS NULL OR status = 'paid'),
  CONSTRAINT package_payments_offline CHECK (
    provider <> 'offline'
    OR (status = 'paid' AND method IN ('upi', 'bank_transfer', 'other') AND length(btrim(coalesce(reference, ''))) BETWEEN 1 AND 100
        AND recorded_by IS NOT NULL AND proof_file_id IS NOT NULL AND proof_url IS NOT NULL AND accounts_check IS NOT NULL)),
  CONSTRAINT package_payments_accounts CHECK ((provider = 'offline') = (accounts_check IS NOT NULL))
);
COMMENT ON TABLE public.package_payments IS 'Package payments: Razorpay tries (created / paid / failed) and manual payments (offline, with proof). The amount is always package price − assessment amount paid, calculated by the database. Never deleted.';
CREATE INDEX package_payments_purchase_idx ON public.package_payments (purchase_id, created_at DESC);
CREATE INDEX package_payments_created_idx ON public.package_payments (created_at DESC);
CREATE TRIGGER package_payments_updated_at BEFORE UPDATE ON public.package_payments FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE OR REPLACE FUNCTION public.package_payments_keep_trigger()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Package payments are never removed.';
END;
$$;
CREATE TRIGGER package_payments_keep BEFORE DELETE ON public.package_payments
  FOR EACH ROW EXECUTE FUNCTION public.package_payments_keep_trigger();

-- Whoever sees the assessment purchase sees its package payments: super admins all, a coordinator their own
-- clients, counsellors none.
ALTER TABLE public.package_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY package_payments_select ON public.package_payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = package_payments.purchase_id));

-- 4. The offer ---------------------------------------------------------------------------------------------

-- The package offer of an assessment purchase, or no row: paid, report presentation done, no package paid yet.
CREATE OR REPLACE FUNCTION public.package_offer(p_purchase uuid)
RETURNS TABLE (package_id uuid, name text, sessions integer, frequency text, price_paise integer, advance_paise integer, amount_paise integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT k.id, k.name, k.sessions, k.frequency, k.price_paise, pu.amount_paise, k.price_paise - pu.amount_paise
  FROM public.purchases pu CROSS JOIN public.packages k
  WHERE pu.id = p_purchase AND pu.kind = 'assessment' AND pu.status = 'paid' AND k.is_active
    AND k.price_paise - pu.amount_paise > 0
    AND EXISTS (SELECT 1 FROM public.presentation_bookings b WHERE b.purchase_id = pu.id AND b.status = 'booked' AND b.done_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = pu.id AND x.kind = 'package' AND x.status = 'paid');
$$;

-- The client's offers (client app, Home).
CREATE OR REPLACE FUNCTION public.package_offers_for_client(p_client uuid)
RETURNS TABLE (purchase_id uuid, package_id uuid, name text, sessions integer, frequency text, price_paise integer, advance_paise integer, amount_paise integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pu.id, o.package_id, o.name, o.sessions, o.frequency, o.price_paise, o.advance_paise, o.amount_paise
  FROM public.purchases pu CROSS JOIN LATERAL public.package_offer(pu.id) o
  WHERE pu.client_id = p_client
  ORDER BY pu.paid_at;
$$;

-- 5. Razorpay tries (client app) -----------------------------------------------------------------------------

-- Records a new Razorpay order for the client's own offer. The amount must be the offer's amount.
CREATE OR REPLACE FUNCTION public.package_payment_start(p_id uuid, p_purchase uuid, p_client uuid, p_order_id text, p_amount integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  o record;
BEGIN
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase;
  IF NOT FOUND OR pu.client_id IS DISTINCT FROM p_client THEN
    RAISE EXCEPTION 'This offer was not found.';
  END IF;
  SELECT * INTO o FROM public.package_offer(p_purchase);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This offer is not available.';
  END IF;
  IF o.amount_paise <> p_amount THEN
    RAISE EXCEPTION 'The amount does not match.';
  END IF;
  IF (SELECT count(*) FROM public.package_payments WHERE purchase_id = p_purchase AND provider = 'razorpay'
        AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Too many attempts. Please try again later.';
  END IF;
  INSERT INTO public.package_payments (id, purchase_id, package_id, package_name, sessions, frequency, price_paise, advance_paise,
                                       amount_paise, phone, client_id, provider, status, provider_order_id)
  VALUES (p_id, p_purchase, o.package_id, o.name, o.sessions, o.frequency, o.price_paise, o.advance_paise,
          o.amount_paise, pu.phone, pu.client_id, 'razorpay', 'created', p_order_id);
END;
$$;

-- A paid package payment becomes the Package purchase. Returns 'paid', or 'duplicate' when a package was already
-- paid for this assessment purchase (then this payment is flagged for a refund and makes no purchase).
CREATE OR REPLACE FUNCTION public.package_settle(p_payment uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pp public.package_payments;
  pu public.purchases;
  v_new uuid;
  v_call uuid;
BEGIN
  SELECT * INTO pp FROM public.package_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND OR pp.status <> 'paid' THEN
    RAISE EXCEPTION 'This package payment is not paid.';
  END IF;
  IF pp.package_purchase_id IS NOT NULL THEN
    RETURN 'paid';
  END IF;
  IF pp.refund_status IS NOT NULL THEN
    RETURN 'duplicate';
  END IF;
  -- One at a time per assessment purchase.
  SELECT * INTO pu FROM public.purchases WHERE id = pp.purchase_id FOR UPDATE;
  SELECT id INTO v_call FROM public.calls WHERE purchase_id = pu.id AND kind = 'package';

  BEGIN
    INSERT INTO public.purchases (kind, test_code, phone, client_id, amount_paise, status, source, coordinator_id, paid_at, parent_purchase_id)
    VALUES ('package', pu.test_code, pu.phone, pu.client_id, pp.amount_paise, 'paid',
            CASE WHEN pp.provider = 'offline' THEN 'manual' ELSE 'pay_page' END, pu.coordinator_id, pp.paid_at, pu.id)
    RETURNING id INTO v_new;
  EXCEPTION WHEN unique_violation THEN
    v_new := NULL;
  END;

  IF v_new IS NULL THEN
    -- Paid twice: no second package. Kept apart for a refund.
    UPDATE public.package_payments SET refund_status = 'needed' WHERE id = pp.id;
    IF v_call IS NOT NULL THEN
      INSERT INTO public.call_logs (call_id, entry, event) VALUES (v_call, 'event', 'package_refund_needed');
    END IF;
    RETURN 'duplicate';
  END IF;

  UPDATE public.package_payments SET package_purchase_id = v_new WHERE id = pp.id;

  -- The Package call closes ("Package paid"), whatever its state was.
  IF v_call IS NOT NULL THEN
    UPDATE public.calls SET status = 'closed', outcome = 'package_paid', closed_at = pp.paid_at WHERE id = v_call;
    INSERT INTO public.call_logs (call_id, at, entry, event, note, by_profile_id, by_name)
    VALUES (v_call, pp.paid_at, 'event', 'package_paid',
            CASE WHEN pp.provider = 'offline' THEN 'Manual payment' ELSE 'Razorpay' END, pp.recorded_by, pp.recorded_by_name);
  END IF;

  -- Journey of the assessment purchase: Package call actual = package paid time.
  UPDATE public.purchase_stages SET done_at = pp.paid_at WHERE purchase_id = pu.id AND stage = 'package_call';
  PERFORM public.purchase_refresh(pu.id);
  RETURN 'paid';
END;
$$;

-- Marks a Razorpay try paid (once) and settles it. Safe to call again (verify and webhook can race).
CREATE OR REPLACE FUNCTION public.package_payment_mark_paid(p_id uuid, p_provider_payment_id text, p_method text, p_paid_at timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.package_payments
  SET status = 'paid', provider_payment_id = p_provider_payment_id, method = p_method, paid_at = p_paid_at,
      failure_code = NULL, failure_reason = NULL
  WHERE id = p_id AND status <> 'paid';
  RETURN public.package_settle(p_id);
END;
$$;

-- A line in the Package call's history for a try that failed, or is still not completed 30 minutes later; the
-- call reopens if it was closed (Not interested, or the older Done). Once per try.
CREATE OR REPLACE FUNCTION public.package_calls_note(p_payment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pp public.package_payments;
  c public.calls;
  v_at timestamptz;
BEGIN
  SELECT * INTO pp FROM public.package_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND OR pp.call_noted_at IS NOT NULL OR pp.status NOT IN ('created', 'failed') THEN
    RETURN;
  END IF;
  v_at := CASE WHEN pp.status = 'failed' THEN pp.updated_at ELSE pp.created_at + interval '30 minutes' END;
  IF v_at > now() THEN
    RETURN;
  END IF;
  UPDATE public.package_payments SET call_noted_at = now() WHERE id = pp.id;
  -- Nothing to chase once a package is paid for this purchase.
  IF EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = pp.purchase_id AND x.kind = 'package' AND x.status = 'paid') THEN
    RETURN;
  END IF;
  SELECT * INTO c FROM public.calls WHERE purchase_id = pp.purchase_id AND kind = 'package' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  INSERT INTO public.call_logs (call_id, at, entry, event)
  VALUES (c.id, v_at, 'event', CASE WHEN pp.status = 'failed' THEN 'package_payment_failed' ELSE 'package_payment_not_completed' END);
  IF c.status = 'closed' AND c.outcome IN ('done', 'not_interested') THEN
    UPDATE public.calls SET status = 'open', outcome = NULL, closed_at = NULL, due_at = public.add_working_hours(v_at, 2) WHERE id = c.id;
    INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (c.id, v_at, 'event', 'reopened');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.package_payment_mark_failed(p_id uuid, p_provider_payment_id text, p_code text, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.package_payments
  SET status = 'failed', provider_payment_id = coalesce(p_provider_payment_id, provider_payment_id), failure_code = p_code, failure_reason = p_reason
  WHERE id = p_id AND status = 'created';
  IF FOUND THEN
    PERFORM public.package_calls_note(p_id);
  END IF;
END;
$$;

-- Tries that failed, or were left not completed for 30 minutes, and are not in a call history yet.
CREATE OR REPLACE FUNCTION public.package_calls_sync()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.package_payments
           WHERE call_noted_at IS NULL
             AND (status = 'failed' OR (status = 'created' AND created_at <= now() - interval '30 minutes'))
           ORDER BY created_at LOOP
    PERFORM public.package_calls_note(r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

-- 6. Manual package payment (coordinator for own clients, super admins) --------------------------------------

CREATE OR REPLACE FUNCTION public.package_payment_manual(
  p_id uuid, p_purchase uuid, p_by uuid, p_method text, p_reference text, p_note text, p_paid_at timestamptz,
  p_proof_file_id text, p_proof_url text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pu public.purchases;
  o record;
  v_role text;
  v_name text;
  v_reference text := btrim(regexp_replace(coalesce(p_reference, ''), '\s+', ' ', 'g'));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  SELECT role, full_name INTO v_role, v_name FROM public.profiles WHERE id = p_by AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'coordinator') THEN
    RAISE EXCEPTION 'Only coordinators and super admins can add a package payment.';
  END IF;
  SELECT * INTO pu FROM public.purchases WHERE id = p_purchase AND kind = 'assessment' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This purchase was not found.';
  END IF;
  IF v_role = 'coordinator' AND pu.coordinator_id IS DISTINCT FROM p_by THEN
    RAISE EXCEPTION 'Only this client''s coordinator can add their package payment.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.purchases x WHERE x.parent_purchase_id = pu.id AND x.kind = 'package' AND x.status = 'paid') THEN
    RAISE EXCEPTION 'A package is already paid for this purchase.';
  END IF;
  SELECT * INTO o FROM public.package_offer(p_purchase);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A package payment can be added after the report presentation is done.';
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
  VALUES (p_id, pu.id, o.package_id, o.name, o.sessions, o.frequency, o.price_paise, o.advance_paise,
          o.amount_paise, pu.phone, pu.client_id, 'offline', 'paid', 'offline_' || p_id, 'offline_' || p_id,
          p_method, v_reference, v_note, p_paid_at, p_by, v_name, p_proof_file_id, p_proof_url, 'pending');
  RETURN public.package_settle(p_id);
END;
$$;

-- 7. Package settings (super admins) -------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.package_save(p_by uuid, p_name text, p_sessions integer, p_frequency text, p_price_paise integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_by AND role = 'super_admin' AND is_active) THEN
    RAISE EXCEPTION 'Only super admins can change the package.';
  END IF;
  IF length(btrim(coalesce(p_name, ''))) < 2 OR length(btrim(p_name)) > 80 THEN
    RAISE EXCEPTION 'Enter the package name (2 to 80 characters).';
  END IF;
  IF p_sessions IS NULL OR p_sessions < 1 OR p_sessions > 100 THEN
    RAISE EXCEPTION 'Enter the number of sessions (1 to 100).';
  END IF;
  IF length(btrim(coalesce(p_frequency, ''))) < 2 OR length(btrim(p_frequency)) > 80 THEN
    RAISE EXCEPTION 'Enter how often the sessions are (2 to 80 characters).';
  END IF;
  IF p_price_paise IS NULL OR p_price_paise <= 350000 OR p_price_paise > 100000000 THEN
    RAISE EXCEPTION 'The package price must be more than the assessment price.';
  END IF;
  UPDATE public.packages
  SET name = btrim(p_name), sessions = p_sessions, frequency = btrim(p_frequency), price_paise = p_price_paise, updated_by = p_by
  WHERE is_active;
END;
$$;

-- 8. Calls: "Client agreed – will pay" and the package tries in the sync -----------------------------------

-- Same as 20261120120000, plus: agreed (Package calls only; the call stays open with a follow-up); Done is not
-- used on Package calls.
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
  IF p_choice IS NULL OR p_choice NOT IN ('done', 'call_later', 'not_picked', 'not_interested', 'agreed')
     OR (c.kind = 'package' AND p_choice = 'done') OR (c.kind <> 'package' AND p_choice = 'agreed') THEN
    RAISE EXCEPTION 'Choose what happened on the call.';
  END IF;
  IF length(v_note) > 2000 THEN
    RAISE EXCEPTION 'The note is too long (2,000 characters at most).';
  END IF;

  IF p_choice IN ('call_later', 'not_picked', 'agreed') THEN
    IF v_follow_up IS NULL OR v_follow_up <= now() OR v_follow_up > public.add_working_hours(now(), 18) THEN
      RAISE EXCEPTION 'Pick a follow-up date and time within 2 working days.';
    END IF;
  ELSE
    v_follow_up := NULL;
  END IF;

  IF p_choice = 'not_interested' THEN
    IF NOT EXISTS (SELECT 1 FROM public.call_logs WHERE call_id = c.id AND entry = 'call') THEN
      RAISE EXCEPTION 'At least one follow-up call is needed first.';
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

  IF p_choice IN ('call_later', 'not_picked', 'agreed') THEN
    UPDATE public.calls SET due_at = v_follow_up WHERE id = c.id;
  ELSE
    UPDATE public.calls SET status = 'closed', outcome = p_choice, closed_at = now() WHERE id = c.id;
    IF p_choice = 'not_interested' AND c.kind = 'payment' THEN
      UPDATE public.purchases SET closed_at = now(), closed_reason = 'not_interested'
      WHERE id = c.purchase_id AND status = 'not_paid' AND closed_at IS NULL;
    END IF;
  END IF;
END;
$$;

-- Same as 20261121100000, plus the package tries at the end.
CREATE OR REPLACE FUNCTION public.calls_sync()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
  v_go timestamptz := (SELECT go_live_at FROM public.call_settings);
BEGIN
  FOR r IN
    SELECT pu.id FROM public.purchases pu
    WHERE pu.status = 'not_paid' AND pu.closed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.purchase_id = pu.id AND c.kind = 'payment')
    UNION
    SELECT c.purchase_id FROM public.calls c JOIN public.purchases pu ON pu.id = c.purchase_id
    WHERE c.kind = 'payment' AND c.status = 'closed' AND c.outcome IN ('done', 'not_interested') AND pu.status = 'not_paid'
      AND EXISTS (SELECT 1 FROM public.purchase_payments pp JOIN public.payments p ON p.id = pp.payment_id
                  WHERE pp.purchase_id = pu.id AND p.created_at > c.closed_at AND p.status IN ('created', 'failed'))
    UNION
    SELECT pu.id FROM public.purchases pu
    JOIN public.purchase_stages s ON s.purchase_id = pu.id AND s.stage = 'assessment'
    WHERE pu.status = 'paid' AND s.done_at IS NULL AND (v_go IS NULL OR pu.paid_at >= v_go - interval '7 days')
      AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.purchase_id = pu.id AND c.kind = 'assessment')
    UNION
    SELECT pu.id FROM public.purchases pu
    JOIN public.purchase_stages s ON s.purchase_id = pu.id AND s.stage = 'assessment'
    WHERE pu.status = 'paid' AND s.done_at IS NOT NULL AND (v_go IS NULL OR s.done_at >= v_go - interval '7 days')
      AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.purchase_id = pu.id AND c.kind = 'booking')
      AND NOT EXISTS (SELECT 1 FROM public.presentation_bookings b WHERE b.purchase_id = pu.id AND b.status = 'booked')
    UNION
    SELECT c.purchase_id FROM public.calls c WHERE c.status = 'open'
  LOOP
    PERFORM public.calls_sync_purchase(r.id);
    n := n + 1;
  END LOOP;
  RETURN n + public.package_calls_sync();
END;
$$;

-- 9. Who may call the functions ----------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.package_offer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_offers_for_client(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_start(uuid, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_settle(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_mark_paid(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_calls_note(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_mark_failed(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_calls_sync() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payment_manual(uuid, uuid, uuid, text, text, text, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_save(uuid, text, integer, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.package_payments_keep_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.calls_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.package_offer(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_offers_for_client(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_start(uuid, uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_mark_paid(uuid, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_mark_failed(uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_calls_sync() TO service_role;
GRANT EXECUTE ON FUNCTION public.package_payment_manual(uuid, uuid, uuid, text, text, text, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.package_save(uuid, text, integer, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.calls_sync() TO service_role;

COMMIT;

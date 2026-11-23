-- A package paid after the purchase was closed (owner, 2026-11-23).
-- Run after 20261123100000_close_purchase.sql.
--
-- REMOVES NO ROWS. No DELETE, no TRUNCATE, nothing dropped except one CHECK rule replaced by a WIDER one (owner's
-- standing permission, 2026-11-20): calls.kind + 'package_inform'. New trigger on purchases; new bodies for
-- calls_not_for_closed_purchase_trigger() and call_mark().
--
-- In plain words:
--   1. The package offer stays visible after "Close purchase" and a late package payment is processed exactly as
--      before (package_settle() is not changed: the Package purchase is made, the Package call closes as paid).
--   2. When that happens on a closed purchase, the client's coordinator gets one short task on that purchase:
--      "Package paid – inform the team" (call kind package_inform), due 2 working hours after the package was paid.
--      Mark as call done offers only Done for it. It never blocks the package payment.
--   3. Nothing else changes.
--
-- Checks: docs/tasks/36-package-after-close-verify.sql · behaviour test supabase/staging/staging-test-package-after-close.sql

BEGIN;

ALTER TABLE public.calls DROP CONSTRAINT calls_kind_check;
ALTER TABLE public.calls ADD CONSTRAINT calls_kind_check CHECK (kind IN ('payment', 'assessment', 'booking', 'package', 'package_inform'));
COMMENT ON COLUMN public.calls.kind IS 'payment · assessment · booking · package · package_inform ("Package paid – inform the team": a package paid after the purchase was closed; Done only).';

-- A closed purchase still gets no new call, except this one task.
CREATE OR REPLACE FUNCTION public.calls_not_for_closed_purchase_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind <> 'package_inform'
     AND EXISTS (SELECT 1 FROM public.purchases WHERE id = NEW.purchase_id AND closed_reason = 'closed_by_staff') THEN
    RETURN NULL;   -- not made; every caller already handles "no call made"
  END IF;
  RETURN NEW;
END;
$$;

-- A Package purchase paid for a closed assessment purchase: the coordinator's task on that assessment purchase.
CREATE OR REPLACE FUNCTION public.purchases_package_after_close_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_at timestamptz := coalesce(NEW.paid_at, now());
  v_call uuid;
BEGIN
  BEGIN
    IF NEW.kind = 'package' AND NEW.status = 'paid'
       AND EXISTS (SELECT 1 FROM public.purchases WHERE id = NEW.parent_purchase_id AND closed_reason = 'closed_by_staff') THEN
      INSERT INTO public.calls (purchase_id, kind, created_at, due_at)
      VALUES (NEW.parent_purchase_id, 'package_inform', v_at, public.add_working_hours(v_at, 2))
      ON CONFLICT (purchase_id, kind) DO NOTHING
      RETURNING id INTO v_call;
      IF v_call IS NOT NULL THEN
        INSERT INTO public.call_logs (call_id, at, entry, event) VALUES (v_call, v_at, 'event', 'created');
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never block a package payment.
    RAISE WARNING 'Package-after-close task for purchase % failed: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;
CREATE TRIGGER purchases_package_after_close AFTER INSERT OR UPDATE OF status ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.purchases_package_after_close_trigger();

-- Same as 20261121300000, plus: "Package paid – inform the team" takes only Done.
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
     OR (c.kind = 'package' AND p_choice = 'done') OR (c.kind <> 'package' AND p_choice = 'agreed')
     OR (c.kind = 'package_inform' AND p_choice <> 'done') THEN
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

REVOKE ALL ON FUNCTION public.calls_not_for_closed_purchase_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purchases_package_after_close_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.call_mark(uuid, uuid, text, text, text, timestamptz) TO service_role;

COMMIT;

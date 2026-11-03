-- ==============================================================================
-- Offline payments with proof (UPI to our number, bank transfer, other) + Google Drive connection.
--
-- DROPS (approved by the owner for this file only, 2026-11-03): two CHECK rules on public.payments are
-- dropped and re-added WIDER in the same transaction. No rows, values or columns are removed; every
-- existing row is re-checked against the new rule and passes (the old values are still allowed).
--   payments.provider   ('razorpay')                   → ('razorpay', 'offline')
--   payments.status     ('created', 'paid', 'failed')  → ('created', 'paid', 'failed', 'cancelled')
--
-- Everything else only ADDS:
--   1. payments          + reference, note, recorded_by, proof_file_id, proof_url (offline payments)
--                        + cancelled_at, cancelled_by, cancel_reason ("Cancel payment", never deleted)
--                        + rules: an offline payment always has its reference, proof and recorder; a
--                          cancelled payment always has who, when and why; only offline payments cancel
--   2. payment_guard()   replaced (CREATE OR REPLACE): every existing rule stays, plus a paid offline
--                        payment that is not started may be cancelled, a cancelled payment never
--                        changes and is never started, an offline payment's details never change
--   3. google_drive_connection   one row: the connected Google account, its refresh token (encrypted
--                        by the app with AES-GCM) and the "MFB Payment Proofs" folder. RLS on, no
--                        policies, no grants: only the server (service role) reads or writes it
--
-- Existing Razorpay payments are not changed. Paste-ready: run in the Supabase SQL Editor.
-- Checks: docs/tasks/18-offline-payments-verify.sql.
-- ==============================================================================

BEGIN;

-- 0. WIDER CHECK RULES (single-column CHECKs on provider and on status, found by column so the exact
-- auto-generated name does not matter; multi-column rules such as payments_paid_has_payment stay).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.conrelid = 'public.payments'::regclass
      AND c.contype = 'c'
      AND cardinality(c.conkey) = 1
      AND a.attname IN ('provider', 'status')
  LOOP
    EXECUTE format('ALTER TABLE public.payments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END;
$$;
ALTER TABLE public.payments ADD CONSTRAINT payments_provider_check CHECK (provider IN ('razorpay', 'offline'));
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK (status IN ('created', 'paid', 'failed', 'cancelled'));

-- 1. OFFLINE AND CANCEL COLUMNS (empty for every existing row)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS recorded_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS proof_file_id text,
  ADD COLUMN IF NOT EXISTS proof_url text,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS cancel_reason text;

COMMENT ON COLUMN public.payments.reference IS 'Offline: UPI transaction ID / bank UTR / other reference typed by staff';
COMMENT ON COLUMN public.payments.note IS 'Offline: optional staff note';
COMMENT ON COLUMN public.payments.recorded_by IS 'Offline: the staff member who recorded the payment';
COMMENT ON COLUMN public.payments.proof_file_id IS 'Offline: Google Drive file ID of the payment proof';
COMMENT ON COLUMN public.payments.proof_url IS 'Offline: Google Drive link of the payment proof';
COMMENT ON COLUMN public.payments.cancelled_at IS 'Cancelled by staff (the row stays; never deleted)';
COMMENT ON COLUMN public.payments.cancel_reason IS 'Why the payment was cancelled (required)';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_offline_details') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_offline_details CHECK (
      provider <> 'offline' OR (
        method IN ('upi', 'bank_transfer', 'other')
        AND length(btrim(reference)) BETWEEN 1 AND 100
        AND proof_file_id IS NOT NULL
        AND proof_url IS NOT NULL
        AND recorded_by IS NOT NULL
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_note_length') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_note_length CHECK (note IS NULL OR length(note) <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_cancelled') THEN
    ALTER TABLE public.payments ADD CONSTRAINT payments_cancelled CHECK (
      (status = 'cancelled') = (cancelled_at IS NOT NULL)
      AND (status <> 'cancelled' OR (
        provider = 'offline'
        AND cancelled_by IS NOT NULL
        AND length(btrim(cancel_reason)) BETWEEN 3 AND 500
        AND attempt_id IS NULL
      ))
    );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_payments_reference ON public.payments (lower(btrim(reference))) WHERE reference IS NOT NULL;

-- 2. GUARD (replaces the version from 20261031000000_pay_first.sql; all its rules are kept)
CREATE OR REPLACE FUNCTION public.payment_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments are never deleted.' USING ERRCODE = '42501';
  END IF;
  IF NEW.test_code IS DISTINCT FROM OLD.test_code
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.amount_paise IS DISTINCT FROM OLD.amount_paise
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id THEN
    RAISE EXCEPTION 'A payment''s test, amount and order never change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.attempt_id IS NOT NULL AND (
       NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.phone IS DISTINCT FROM OLD.phone) THEN
    RAISE EXCEPTION 'A started purchase keeps its owner and assessment.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'paid' AND (
       NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at) THEN
    RAISE EXCEPTION 'A paid payment cannot change.' USING ERRCODE = '42501';
  END IF;
  -- Paid stays paid; the one exception: an offline payment that is not started may be cancelled.
  IF OLD.status = 'paid' AND NEW.status <> 'paid' AND NOT (
       NEW.status = 'cancelled' AND OLD.provider = 'offline' AND OLD.attempt_id IS NULL AND NEW.attempt_id IS NULL) THEN
    RAISE EXCEPTION 'A paid payment cannot change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'cancelled' AND (
       NEW.status <> 'cancelled'
       OR NEW.attempt_id IS NOT NULL
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.phone IS DISTINCT FROM OLD.phone
       OR NEW.refund_status IS DISTINCT FROM OLD.refund_status
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
       OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
       OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason) THEN
    RAISE EXCEPTION 'A cancelled payment never changes.' USING ERRCODE = '42501';
  END IF;
  IF OLD.provider = 'offline' AND (
       NEW.method IS DISTINCT FROM OLD.method
       OR NEW.reference IS DISTINCT FROM OLD.reference
       OR NEW.note IS DISTINCT FROM OLD.note
       OR NEW.recorded_by IS DISTINCT FROM OLD.recorded_by
       OR NEW.proof_file_id IS DISTINCT FROM OLD.proof_file_id
       OR NEW.proof_url IS DISTINCT FROM OLD.proof_url) THEN
    RAISE EXCEPTION 'An offline payment''s details and proof never change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.refund_status = 'refunded' AND NEW.refund_status IS DISTINCT FROM 'refunded' THEN
    RAISE EXCEPTION 'A refunded purchase stays refunded.' USING ERRCODE = '42501';
  END IF;
  IF OLD.attempt_id IS NULL AND NEW.attempt_id IS NOT NULL AND NEW.refund_status IS NOT NULL THEN
    RAISE EXCEPTION 'A purchase marked for refund cannot be started.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. GOOGLE DRIVE CONNECTION (one row; server only)
CREATE TABLE IF NOT EXISTS public.google_drive_connection (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  account_email text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  folder_id text NOT NULL,
  folder_url text NOT NULL,
  connected_by uuid REFERENCES public.profiles(id),
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.google_drive_connection IS 'The Google account that stores payment proofs: refresh token encrypted by the app (AES-GCM), the folder the app created. Server only';

DROP TRIGGER IF EXISTS trg_google_drive_connection_updated_at ON public.google_drive_connection;
CREATE TRIGGER trg_google_drive_connection_updated_at BEFORE UPDATE ON public.google_drive_connection
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.google_drive_connection ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. And no table rights for the browser roles at all.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.google_drive_connection FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.google_drive_connection FROM authenticated;
  END IF;
END;
$$;

COMMIT;

-- ==============================================================================
-- Send SMS hook v2 (replaces public.custom_send_sms from 20261013000001).
--
-- 1. Phone format: Renflair's V1 OTP API takes the 10-digit Indian mobile number. The first version
--    sent 91XXXXXXXXXX, which Renflair answers with "PHONE NUMBER INCORRECT FORMAT". Now any of
--    +91XXXXXXXXXX / 91XXXXXXXXXX / 0XXXXXXXXXX / XXXXXXXXXX becomes the 10 digits; anything else is
--    refused with a clear message shown on the login screen.
-- 2. API key: read from Supabase Vault (secret name "renflair_api_key"), never written in SQL.
--
-- BEFORE running this file, store the key once in the SQL Editor (do not save that query or commit it):
--     select vault.create_secret('<your Renflair API key>', 'renflair_api_key', 'Renflair OTP API key');
-- To change the key later:
--     select vault.update_secret(id, '<new key>') from vault.secrets where name = 'renflair_api_key';
--
-- Then enable the hook if it is not yet: Authentication → Auth Hooks → Send SMS hook → Postgres →
-- public.custom_send_sms. Checks: docs/tasks/09-sms-hook-verify.sql.
-- ==============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.custom_send_sms(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  v_raw text := coalesce(event->'user'->>'phone', event->>'phone', '');
  v_otp text := coalesce(event->'sms'->>'otp', event->>'otp', '');
  v_digits text;
  v_key text;
BEGIN
  -- Digits only, then the 10-digit Indian mobile number.
  v_digits := regexp_replace(v_raw, '\D', '', 'g');
  IF length(v_digits) = 12 AND left(v_digits, 2) = '91' THEN
    v_digits := right(v_digits, 10);
  ELSIF length(v_digits) = 11 AND left(v_digits, 1) = '0' THEN
    v_digits := right(v_digits, 10);
  END IF;

  IF v_digits !~ '^[6-9][0-9]{9}$' THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 400, 'message', 'Please enter a valid 10-digit Indian mobile number.'));
  END IF;
  IF v_otp !~ '^[0-9]{4,10}$' THEN
    RETURN jsonb_build_object('error', jsonb_build_object('http_code', 500, 'message', 'Could not send the code.'));
  END IF;

  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'renflair_api_key' LIMIT 1;
  IF v_key IS NULL OR v_key = '' THEN
    RAISE WARNING 'custom_send_sms: Vault secret renflair_api_key is missing';
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 500, 'message', 'SMS is not available right now. Please try again later.'));
  END IF;

  -- Asynchronous GET through pg_net; Renflair's reply lands in net._http_response.
  PERFORM net.http_get(
    url := 'https://sms.renflair.in/V1.php',
    params := jsonb_build_object('API', v_key, 'PHONE', v_digits, 'OTP', v_otp)
  );

  RETURN '{}'::jsonb;
END;
$$;
COMMENT ON FUNCTION public.custom_send_sms(jsonb) IS
  'Supabase Send SMS hook: sends the OTP to the 10-digit number through Renflair; key from Vault (renflair_api_key)';

-- Only Supabase Auth runs the hook.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_send_sms(jsonb) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_send_sms(jsonb) FROM authenticated, anon, public;

COMMIT;

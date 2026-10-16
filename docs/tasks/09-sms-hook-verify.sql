-- Verification for supabase/migrations/20261023000000_sms_hook_v2.sql. Run each part on its own.

-- 1. The Vault secret exists (shows only the name, never the key).
select name, created_at, updated_at from vault.secrets where name = 'renflair_api_key';

-- 2. Supabase Auth can run the hook; anon/authenticated cannot.
select has_function_privilege('supabase_auth_admin', 'public.custom_send_sms(jsonb)', 'execute') as auth_admin, -- true
       has_function_privilege('anon', 'public.custom_send_sms(jsonb)', 'execute') as anon;                     -- false

-- 3. Format handling without sending anything: an invalid number returns the error object.
select public.custom_send_sms('{"user":{"phone":"+91123"},"sms":{"otp":"123456"}}'::jsonb);
-- Expect: {"error": {"message": "Please enter a valid 10-digit Indian mobile number.", "http_code": 400}}

-- 4. Real test: put YOUR mobile number in, run, wait ~5 seconds, then run part 5.
--    You should get an SMS with the code 123456.
select public.custom_send_sms('{"user":{"phone":"+91XXXXXXXXXX"},"sms":{"otp":"123456"}}'::jsonb);

-- 5. Renflair's latest replies (kept about 6 hours).
select created, status_code, left(content, 300) as renflair_reply, error_msg
from net._http_response order by created desc limit 5;

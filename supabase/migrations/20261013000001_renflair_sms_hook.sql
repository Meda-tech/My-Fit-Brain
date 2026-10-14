-- ==============================================================================
-- RENFLAIR SEND SMS AUTH HOOK
-- Strips '+' from +91 numbers so Renflair receives clean 91XXXXXXXXXX format
-- ==============================================================================

-- 1. Ensure the pg_net HTTP networking extension is enabled in Supabase
create extension if not exists pg_net with schema extensions;

-- 2. Drop previous function signature (if created with returns void)
drop function if exists public.custom_send_sms(jsonb);

-- 3. Create the Send SMS Auth Hook function (accepts jsonb AND returns jsonb)
create or replace function public.custom_send_sms(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, net
as $$
declare
    raw_phone text;
    clean_phone text;
    otp_code text;
    renflair_api_key text := '4aa349c41601514fd09b204ff71a88b4';
    request_url text;
begin
    -- Extract phone and OTP from the Supabase Auth Hook event payload
    raw_phone := coalesce(event->'user'->>'phone', event->>'phone', '');
    otp_code  := coalesce(event->'sms'->>'otp', event->>'otp', '');

    -- Only proceed if phone and OTP are present
    if raw_phone is not null and raw_phone <> '' and otp_code is not null and otp_code <> '' then
        -- Remove '+' if present so +91XXXXXXXXXX becomes 91XXXXXXXXXX
        clean_phone := regexp_replace(raw_phone, '^\+', '');

        -- Remove any stray spaces, dashes or parentheses
        clean_phone := regexp_replace(clean_phone, '[\s\-\(\)]', '', 'g');

        -- If 10 digits without country code, prepend 91
        if length(clean_phone) = 10 then
            clean_phone := '91' || clean_phone;
        end if;

        -- Construct the Renflair GET URL with clean 91XXXXXXXXXX phone
        request_url := 'https://sms.renflair.in/V1.php?API=' || renflair_api_key 
                       || '&PHONE=' || clean_phone 
                       || '&OTP=' || otp_code;

        -- Dispatch asynchronous HTTP GET request through pg_net (non-blocking)
        perform net.http_get(url := request_url);
    end if;

    -- Return empty JSONB object as required by Supabase Auth Hooks
    return '{}'::jsonb;
end;
$$;

-- 4. Grant required execution privileges to Supabase internal auth admin
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_send_sms(jsonb) to supabase_auth_admin;

-- 5. Revoke public/anonymous access for security
revoke execute on function public.custom_send_sms(jsonb) from authenticated, anon, public;

-- 6. Clean up: Standardize any existing clients in DB to +91 format
update public.clients
set phone = '+' || phone
where phone not like '+%' and phone like '91%';

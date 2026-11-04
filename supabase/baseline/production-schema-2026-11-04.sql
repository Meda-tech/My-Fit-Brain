


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."attempt_answer_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.attempts WHERE id = coalesce(NEW.attempt_id, OLD.attempt_id);
  IF v_status = 'completed' THEN
    RAISE EXCEPTION 'Answers of a completed assessment never change.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."attempt_answer_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attempt_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Assessments are never deleted.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'completed' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.language IS DISTINCT FROM OLD.language OR NEW.consent_at IS DISTINCT FROM OLD.consent_at
       OR NEW.started_at IS DISTINCT FROM OLD.started_at) THEN
    RAISE EXCEPTION 'A completed assessment never changes.' USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id OR NEW.report_id <> OLD.report_id OR NEW.client_id <> OLD.client_id
     OR NEW.questionnaire_code <> OLD.questionnaire_code OR NEW.version_id <> OLD.version_id
     OR NEW.payment_ref <> OLD.payment_ref OR NEW.paid_at <> OLD.paid_at THEN
    RAISE EXCEPTION 'The identity of an assessment never changes.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."attempt_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."attempt_result_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RAISE EXCEPTION 'Results are written once and never change.' USING ERRCODE = '42501';
END;
$$;


ALTER FUNCTION "public"."attempt_result_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_view_payments"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role IN ('super_admin', 'coordinator')
      AND is_active = true
  );
$$;


ALTER FUNCTION "public"."can_view_payments"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_view_payments"() IS 'Active super admin or coordinator: may read payments';



CREATE OR REPLACE FUNCTION "public"."can_view_reports"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role IN ('super_admin', 'counsellor')
      AND is_active = true
  );
$$;


ALTER FUNCTION "public"."can_view_reports"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."can_view_reports"() IS 'Active super admin or counsellor: may read assessment answers and results';



CREATE OR REPLACE FUNCTION "public"."create_paid_attempt"("p_client_id" "uuid", "p_code" "text", "p_version_id" "uuid", "p_payment_ref" "text", "p_paid_at" timestamp with time zone, "p_language" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_attempt public.attempts;
BEGIN
  IF p_payment_ref IS NULL OR length(p_payment_ref) = 0 THEN
    RAISE EXCEPTION 'A paid attempt needs the payment reference.';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('attempt:' || p_payment_ref, 0));
  SELECT * INTO v_attempt FROM public.attempts WHERE payment_ref = p_payment_ref;
  IF FOUND THEN
    RETURN jsonb_build_object('created', false, 'attempt', to_jsonb(v_attempt));
  END IF;
  INSERT INTO public.attempts (report_id, client_id, questionnaire_code, version_id, status, language, payment_ref, paid_at)
  VALUES (public.next_report_id(p_code), p_client_id, p_code, p_version_id, 'paid', coalesce(p_language, 'en'), p_payment_ref, p_paid_at)
  RETURNING * INTO v_attempt;
  RETURN jsonb_build_object('created', true, 'attempt', to_jsonb(v_attempt));
END;
$$;


ALTER FUNCTION "public"."create_paid_attempt"("p_client_id" "uuid", "p_code" "text", "p_version_id" "uuid", "p_payment_ref" "text", "p_paid_at" timestamp with time zone, "p_language" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."custom_send_sms"("event" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'net'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."custom_send_sms"("event" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."custom_send_sms"("event" "jsonb") IS 'Supabase Send SMS hook: sends the OTP to the 10-digit number through Renflair; key from Vault (renflair_api_key)';



CREATE OR REPLACE FUNCTION "public"."get_current_staff_profile_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id FROM public.profiles
  WHERE auth_user_id = (SELECT auth.uid())
    AND is_active = true
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_current_staff_profile_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_active_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_counsellor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role = 'counsellor'
      AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_counsellor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE auth_user_id = (SELECT auth.uid())
      AND role = 'super_admin'
      AND is_active = true
  );
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_client_phone"("p_phone" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_auth_uid uuid;
  v_client_id uuid;
  v_record RECORD;
BEGIN
  v_auth_uid := (SELECT auth.uid());
  IF v_auth_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Look for client record with normalized phone
  SELECT * INTO v_record FROM public.clients WHERE phone = p_phone LIMIT 1;

  IF FOUND THEN
    -- If already linked to another auth user, prevent takeover
    IF v_record.auth_user_id IS NOT NULL AND v_record.auth_user_id <> v_auth_uid THEN
      RETURN jsonb_build_object('success', false, 'error', 'Phone number already associated with another account');
    END IF;

    -- Link auth user ID
    UPDATE public.clients
    SET auth_user_id = v_auth_uid, updated_at = now()
    WHERE id = v_record.id;

    RETURN jsonb_build_object('success', true, 'status', 'linked', 'client_id', v_record.id);
  ELSE
    RETURN jsonb_build_object('success', true, 'status', 'needs_registration');
  END IF;
END;
$$;


ALTER FUNCTION "public"."link_client_phone"("p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."next_report_id"("p_code" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_prefix text;
  v_year integer := extract(year FROM (now() AT TIME ZONE 'Asia/Kolkata'))::integer;
  v_number integer;
BEGIN
  SELECT report_prefix INTO v_prefix FROM public.questionnaires WHERE code = p_code;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unknown questionnaire %.', p_code;
  END IF;
  INSERT INTO public.report_counters AS c (test_code, year, last_number)
  VALUES (p_code, v_year, 1)
  ON CONFLICT (test_code, year) DO UPDATE SET last_number = c.last_number + 1
  RETURNING last_number INTO v_number;
  RETURN v_prefix || '-' || v_year || '-' || lpad(v_number::text, 5, '0');
END;
$$;


ALTER FUNCTION "public"."next_report_id"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."payment_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
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


ALTER FUNCTION "public"."payment_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."publish_questionnaire_version"("p_version_id" "uuid", "p_by" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v public.questionnaire_versions;
BEGIN
  SELECT * INTO v FROM public.questionnaire_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Version not found.';
  END IF;
  IF v.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft can be published.';
  END IF;
  UPDATE public.questionnaire_versions SET status = 'retired'
  WHERE questionnaire_code = v.questionnaire_code AND status = 'live';
  UPDATE public.questionnaire_versions
  SET status = 'live', published_by = p_by, published_at = now()
  WHERE id = p_version_id;
END;
$$;


ALTER FUNCTION "public"."publish_questionnaire_version"("p_version_id" "uuid", "p_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."questionnaire_version_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Published versions are never deleted.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'live' AND NEW.status = 'retired'
     AND NEW.definition = OLD.definition AND NEW.number = OLD.number
     AND NEW.questionnaire_code = OLD.questionnaire_code AND NEW.published_at = OLD.published_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Published versions never change.' USING ERRCODE = '42501';
END;
$$;


ALTER FUNCTION "public"."questionnaire_version_guard"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."age_stops" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "full_name" "text",
    "age" integer NOT NULL,
    "auth_user_id" "uuid",
    "first_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "age_stops_age_check" CHECK ((("age" >= 1) AND ("age" <= 17))),
    CONSTRAINT "age_stops_full_name_check" CHECK ((("full_name" IS NULL) OR (("char_length"("full_name") >= 1) AND ("char_length"("full_name") <= 200)))),
    CONSTRAINT "age_stops_phone_check" CHECK (("phone" ~ '^\+91[6-9][0-9]{9}$'::"text"))
);


ALTER TABLE "public"."age_stops" OWNER TO "postgres";


COMMENT ON TABLE "public"."age_stops" IS 'Under-18 stops at registration: number, name, age entered, when. Minimal record for refunds; no other details.';



CREATE TABLE IF NOT EXISTS "public"."attempt_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attempt_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "handled_by" "uuid",
    "handled_at" timestamp with time zone,
    CONSTRAINT "attempt_alerts_kind_check" CHECK (("kind" = ANY (ARRAY['crisis'::"text", 'home_safety'::"text"])))
);


ALTER TABLE "public"."attempt_alerts" OWNER TO "postgres";


COMMENT ON TABLE "public"."attempt_alerts" IS 'Crisis and home-safety alerts for the team (one per attempt and kind)';



CREATE TABLE IF NOT EXISTS "public"."attempt_answers" (
    "attempt_id" "uuid" NOT NULL,
    "question_id" "text" NOT NULL,
    "option_ids" "text"[] NOT NULL,
    "answered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attempt_answers_option_ids_check" CHECK (("cardinality"("option_ids") >= 1))
);


ALTER TABLE "public"."attempt_answers" OWNER TO "postgres";


COMMENT ON TABLE "public"."attempt_answers" IS 'Chosen option ids per question; never free text';



CREATE TABLE IF NOT EXISTS "public"."attempt_details" (
    "attempt_id" "uuid" NOT NULL,
    "detail_id" "text" NOT NULL,
    "question" "jsonb" NOT NULL,
    "answer" "text" NOT NULL,
    "sort" integer DEFAULT 0 NOT NULL,
    "answered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attempt_details_answer_check" CHECK ((("length"("btrim"("answer")) >= 1) AND ("length"("btrim"("answer")) <= 2000))),
    CONSTRAINT "attempt_details_detail_id_check" CHECK (("detail_id" ~ '^[A-Za-z][A-Za-z0-9_]*$'::"text")),
    CONSTRAINT "attempt_details_question_check" CHECK (("jsonb_typeof"("question") = 'object'::"text"))
);


ALTER TABLE "public"."attempt_details" OWNER TO "postgres";


COMMENT ON TABLE "public"."attempt_details" IS 'Typed client-details answers, with the question as it was asked; care team only (can_view_reports())';



CREATE TABLE IF NOT EXISTS "public"."attempt_results" (
    "attempt_id" "uuid" NOT NULL,
    "result" "jsonb" NOT NULL,
    "report" "jsonb" NOT NULL,
    "engine_version" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."attempt_results" OWNER TO "postgres";


COMMENT ON TABLE "public"."attempt_results" IS 'The engine result and the stored report (counsellor and PDF read these)';



CREATE TABLE IF NOT EXISTS "public"."attempts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "report_id" "text" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "questionnaire_code" "text" NOT NULL,
    "version_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'paid'::"text" NOT NULL,
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "payment_ref" "text" NOT NULL,
    "paid_at" timestamp with time zone NOT NULL,
    "consent_at" timestamp with time zone,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "attempts_language_check" CHECK (("language" = ANY (ARRAY['en'::"text", 'hi'::"text"]))),
    CONSTRAINT "attempts_status_check" CHECK (("status" = ANY (ARRAY['paid'::"text", 'in_progress'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."attempts" OWNER TO "postgres";


COMMENT ON TABLE "public"."attempts" IS 'One paid assessment, pinned to the version live when it was paid';



CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "phone" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "gender" "text" NOT NULL,
    "age" integer NOT NULL,
    "marital_status" "text" NOT NULL,
    "city" "text",
    "state" "text",
    "email" "text",
    "created_by_profile_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clients_age_check" CHECK ((("age" >= 18) AND ("age" <= 120))),
    CONSTRAINT "clients_gender_check" CHECK (("gender" = ANY (ARRAY['Male'::"text", 'Female'::"text", 'Prefer not to say'::"text"]))),
    CONSTRAINT "clients_marital_status_check" CHECK (("marital_status" = ANY (ARRAY['Single'::"text", 'In a relationship'::"text", 'Engaged'::"text", 'Married'::"text", 'Separated'::"text", 'Divorced'::"text", 'Widowed'::"text"])))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


COMMENT ON TABLE "public"."clients" IS 'Client demographics and assessment identity';



COMMENT ON COLUMN "public"."clients"."auth_user_id" IS 'Supabase Auth user mapping after phone OTP verification';



COMMENT ON COLUMN "public"."clients"."phone" IS 'Normalized E.164 phone number, unique';



COMMENT ON COLUMN "public"."clients"."marital_status" IS 'Relationship status — matches question I3';



COMMENT ON COLUMN "public"."clients"."created_by_profile_id" IS 'Staff member who created the record, if pre-created';



CREATE TABLE IF NOT EXISTS "public"."payment_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "event" "text" NOT NULL,
    "provider_order_id" "text",
    "provider_payment_id" "text",
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payment_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_events" IS 'Processed Razorpay webhook events (ids only, no payloads)';



CREATE TABLE IF NOT EXISTS "public"."payment_moves" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "from_phone" "text" NOT NULL,
    "to_phone" "text" NOT NULL,
    "from_client_id" "uuid",
    "moved_by" "uuid" NOT NULL,
    "moved_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payment_moves_to_phone_check" CHECK (("to_phone" ~ '^\+[1-9][0-9]{9,14}$'::"text"))
);


ALTER TABLE "public"."payment_moves" OWNER TO "postgres";


COMMENT ON TABLE "public"."payment_moves" IS 'Purchases moved to another phone number by staff (who, when, from, to)';



CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "client_id" "uuid",
    "test_code" "text" NOT NULL,
    "provider" "text" DEFAULT 'razorpay'::"text" NOT NULL,
    "amount_paise" integer NOT NULL,
    "currency" "text" DEFAULT 'INR'::"text" NOT NULL,
    "status" "text" DEFAULT 'created'::"text" NOT NULL,
    "provider_order_id" "text" NOT NULL,
    "provider_payment_id" "text",
    "method" "text",
    "failure_code" "text",
    "failure_reason" "text",
    "attempt_id" "uuid",
    "paid_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "phone" "text" NOT NULL,
    "claimed_at" timestamp with time zone,
    "refund_status" "text",
    "ip_hash" "text",
    "reference" "text",
    "note" "text",
    "recorded_by" "uuid",
    "proof_file_id" "text",
    "proof_url" "text",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "uuid",
    "cancel_reason" "text",
    CONSTRAINT "payments_amount_paise_check" CHECK (("amount_paise" > 0)),
    CONSTRAINT "payments_attempt_has_client" CHECK ((("attempt_id" IS NULL) OR ("client_id" IS NOT NULL))),
    CONSTRAINT "payments_cancelled" CHECK (((("status" = 'cancelled'::"text") = ("cancelled_at" IS NOT NULL)) AND (("status" <> 'cancelled'::"text") OR (("provider" = 'offline'::"text") AND ("cancelled_by" IS NOT NULL) AND (("length"("btrim"("cancel_reason")) >= 3) AND ("length"("btrim"("cancel_reason")) <= 500)) AND ("attempt_id" IS NULL))))),
    CONSTRAINT "payments_claimed" CHECK ((("client_id" IS NULL) = ("claimed_at" IS NULL))),
    CONSTRAINT "payments_currency_check" CHECK (("currency" = 'INR'::"text")),
    CONSTRAINT "payments_note_length" CHECK ((("note" IS NULL) OR ("length"("note") <= 500))),
    CONSTRAINT "payments_offline_details" CHECK ((("provider" <> 'offline'::"text") OR (("method" = ANY (ARRAY['upi'::"text", 'bank_transfer'::"text", 'other'::"text"])) AND (("length"("btrim"("reference")) >= 1) AND ("length"("btrim"("reference")) <= 100)) AND ("proof_file_id" IS NOT NULL) AND ("proof_url" IS NOT NULL) AND ("recorded_by" IS NOT NULL)))),
    CONSTRAINT "payments_paid_has_payment" CHECK ((("status" <> 'paid'::"text") OR (("provider_payment_id" IS NOT NULL) AND ("paid_at" IS NOT NULL)))),
    CONSTRAINT "payments_provider_check" CHECK (("provider" = ANY (ARRAY['razorpay'::"text", 'offline'::"text"]))),
    CONSTRAINT "payments_refund_status" CHECK ((("refund_status" IS NULL) OR (("refund_status" = ANY (ARRAY['needed'::"text", 'refunded'::"text"])) AND ("status" = 'paid'::"text")))),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['created'::"text", 'paid'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."payments" IS 'Razorpay checkouts; status paid only after server-side verification';



COMMENT ON COLUMN "public"."payments"."client_id" IS 'Empty until a client logs in with the phone (claim)';



COMMENT ON COLUMN "public"."payments"."phone" IS 'E.164 phone the purchase belongs to (typed on the pay page, or the signed-in client''s)';



COMMENT ON COLUMN "public"."payments"."claimed_at" IS 'When the purchase was linked to the client';



COMMENT ON COLUMN "public"."payments"."refund_status" IS 'needed (e.g. under 18 at registration) → refunded (staff, after refunding in Razorpay)';



COMMENT ON COLUMN "public"."payments"."ip_hash" IS 'Keyed hash of the buyer''s IP, only for rate limiting order creation';



COMMENT ON COLUMN "public"."payments"."reference" IS 'Offline: UPI transaction ID / bank UTR / other reference typed by staff';



COMMENT ON COLUMN "public"."payments"."note" IS 'Offline: optional staff note';



COMMENT ON COLUMN "public"."payments"."recorded_by" IS 'Offline: the staff member who recorded the payment';



COMMENT ON COLUMN "public"."payments"."proof_file_id" IS 'Offline: Google Drive file ID of the payment proof';



COMMENT ON COLUMN "public"."payments"."proof_url" IS 'Offline: Google Drive link of the payment proof';



COMMENT ON COLUMN "public"."payments"."cancelled_at" IS 'Cancelled by staff (the row stays; never deleted)';



COMMENT ON COLUMN "public"."payments"."cancel_reason" IS 'Why the payment was cancelled (required)';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "auth_user_id" "uuid",
    "email" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "can_edit_content" boolean DEFAULT false NOT NULL,
    "can_approve_content" boolean DEFAULT false NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['super_admin'::"text", 'coordinator'::"text", 'counsellor'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."profiles" IS 'Internal staff identity and role authorization';



COMMENT ON COLUMN "public"."profiles"."id" IS 'Stable application UUID';



COMMENT ON COLUMN "public"."profiles"."auth_user_id" IS 'Supabase Auth user mapping (nullable before invite or link)';



COMMENT ON COLUMN "public"."profiles"."role" IS 'Staff role: super_admin, coordinator or counsellor';



COMMENT ON COLUMN "public"."profiles"."can_edit_content" IS 'May import, copy, edit and submit question bank drafts';



COMMENT ON COLUMN "public"."profiles"."can_approve_content" IS 'May publish question bank versions';



CREATE TABLE IF NOT EXISTS "public"."questionnaire_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "questionnaire_code" "text" NOT NULL,
    "number" integer NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "definition" "jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_by" "uuid",
    "published_at" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "questionnaire_versions_number_check" CHECK (("number" > 0)),
    CONSTRAINT "questionnaire_versions_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'live'::"text", 'retired'::"text"])))
);


ALTER TABLE "public"."questionnaire_versions" OWNER TO "postgres";


COMMENT ON TABLE "public"."questionnaire_versions" IS 'Versions of a questionnaire; the definition is the imported JSON';



CREATE TABLE IF NOT EXISTS "public"."questionnaires" (
    "code" "text" NOT NULL,
    "name_en" "text" NOT NULL,
    "name_hi" "text",
    "report_prefix" "text" NOT NULL,
    "sort" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "client_details" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "active_changed_at" timestamp with time zone,
    "active_changed_by" "uuid",
    CONSTRAINT "questionnaires_client_details_check" CHECK (("jsonb_typeof"("client_details") = 'array'::"text")),
    CONSTRAINT "questionnaires_code_check" CHECK (("code" ~ '^[A-Z]{1,8}$'::"text")),
    CONSTRAINT "questionnaires_report_prefix_check" CHECK (("report_prefix" ~ '^[A-Z-]{2,16}$'::"text"))
);


ALTER TABLE "public"."questionnaires" OWNER TO "postgres";


COMMENT ON TABLE "public"."questionnaires" IS 'One row per assessment (test): code, names, report ID prefix';



COMMENT ON COLUMN "public"."questionnaires"."client_details" IS 'Client-details questions asked after the safety questions: [{id, text {en, hi}}]. Edited at any time; not versioned';



COMMENT ON COLUMN "public"."questionnaires"."is_active" IS 'Off = nobody can buy it (pay link and Home). Paid purchases and running assessments are not affected.';



CREATE TABLE IF NOT EXISTS "public"."report_counters" (
    "test_code" "text" NOT NULL,
    "year" integer NOT NULL,
    "last_number" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."report_counters" OWNER TO "postgres";


ALTER TABLE ONLY "public"."age_stops"
    ADD CONSTRAINT "age_stops_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."age_stops"
    ADD CONSTRAINT "age_stops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attempt_alerts"
    ADD CONSTRAINT "attempt_alerts_attempt_id_kind_key" UNIQUE ("attempt_id", "kind");



ALTER TABLE ONLY "public"."attempt_alerts"
    ADD CONSTRAINT "attempt_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attempt_answers"
    ADD CONSTRAINT "attempt_answers_pkey" PRIMARY KEY ("attempt_id", "question_id");



ALTER TABLE ONLY "public"."attempt_details"
    ADD CONSTRAINT "attempt_details_pkey" PRIMARY KEY ("attempt_id", "detail_id");



ALTER TABLE ONLY "public"."attempt_results"
    ADD CONSTRAINT "attempt_results_pkey" PRIMARY KEY ("attempt_id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_payment_ref_key" UNIQUE ("payment_ref");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_report_id_key" UNIQUE ("report_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_events"
    ADD CONSTRAINT "payment_events_provider_event_id_key" UNIQUE ("provider_event_id");



ALTER TABLE ONLY "public"."payment_moves"
    ADD CONSTRAINT "payment_moves_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_attempt_id_key" UNIQUE ("attempt_id");



ALTER TABLE "public"."payments"
    ADD CONSTRAINT "payments_phone_e164" CHECK (("phone" ~ '^\+[1-9][0-9]{9,14}$'::"text")) NOT VALID;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_provider_order_id_key" UNIQUE ("provider_order_id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_provider_payment_id_key" UNIQUE ("provider_payment_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."questionnaire_versions"
    ADD CONSTRAINT "questionnaire_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."questionnaire_versions"
    ADD CONSTRAINT "questionnaire_versions_questionnaire_code_number_key" UNIQUE ("questionnaire_code", "number");



ALTER TABLE ONLY "public"."questionnaires"
    ADD CONSTRAINT "questionnaires_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."questionnaires"
    ADD CONSTRAINT "questionnaires_report_prefix_key" UNIQUE ("report_prefix");



ALTER TABLE ONLY "public"."report_counters"
    ADD CONSTRAINT "report_counters_pkey" PRIMARY KEY ("test_code", "year");



CREATE INDEX "idx_attempts_client" ON "public"."attempts" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_clients_auth_user_id" ON "public"."clients" USING "btree" ("auth_user_id");



CREATE INDEX "idx_clients_created_at" ON "public"."clients" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_clients_created_by_profile_id" ON "public"."clients" USING "btree" ("created_by_profile_id");



CREATE INDEX "idx_clients_phone" ON "public"."clients" USING "btree" ("phone");



CREATE INDEX "idx_payment_moves_payment" ON "public"."payment_moves" USING "btree" ("payment_id", "moved_at" DESC);



CREATE INDEX "idx_payments_attempt" ON "public"."payments" USING "btree" ("attempt_id");



CREATE INDEX "idx_payments_client" ON "public"."payments" USING "btree" ("client_id", "created_at" DESC);



CREATE INDEX "idx_payments_ip" ON "public"."payments" USING "btree" ("ip_hash", "created_at" DESC) WHERE ("ip_hash" IS NOT NULL);



CREATE INDEX "idx_payments_phone" ON "public"."payments" USING "btree" ("phone", "created_at" DESC);



CREATE INDEX "idx_payments_reference" ON "public"."payments" USING "btree" ("lower"("btrim"("reference"))) WHERE ("reference" IS NOT NULL);



CREATE INDEX "idx_payments_unclaimed" ON "public"."payments" USING "btree" ("phone") WHERE (("client_id" IS NULL) AND ("status" = 'paid'::"text"));



CREATE INDEX "idx_profiles_auth_user_id" ON "public"."profiles" USING "btree" ("auth_user_id");



CREATE INDEX "idx_profiles_email" ON "public"."profiles" USING "btree" ("email");



CREATE INDEX "idx_profiles_role_active" ON "public"."profiles" USING "btree" ("role", "is_active");



CREATE UNIQUE INDEX "questionnaire_versions_one_draft" ON "public"."questionnaire_versions" USING "btree" ("questionnaire_code") WHERE ("status" = 'draft'::"text");



CREATE UNIQUE INDEX "questionnaire_versions_one_live" ON "public"."questionnaire_versions" USING "btree" ("questionnaire_code") WHERE ("status" = 'live'::"text");



CREATE OR REPLACE TRIGGER "trg_attempt_answers_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."attempt_answers" FOR EACH ROW EXECUTE FUNCTION "public"."attempt_answer_guard"();



CREATE OR REPLACE TRIGGER "trg_attempt_details_guard" BEFORE INSERT OR DELETE OR UPDATE ON "public"."attempt_details" FOR EACH ROW EXECUTE FUNCTION "public"."attempt_answer_guard"();



CREATE OR REPLACE TRIGGER "trg_attempt_results_guard" BEFORE DELETE OR UPDATE ON "public"."attempt_results" FOR EACH ROW EXECUTE FUNCTION "public"."attempt_result_guard"();



CREATE OR REPLACE TRIGGER "trg_attempts_guard" BEFORE DELETE OR UPDATE ON "public"."attempts" FOR EACH ROW EXECUTE FUNCTION "public"."attempt_guard"();



CREATE OR REPLACE TRIGGER "trg_attempts_updated_at" BEFORE UPDATE ON "public"."attempts" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_payments_guard" BEFORE DELETE OR UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."payment_guard"();



CREATE OR REPLACE TRIGGER "trg_payments_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_questionnaire_versions_guard" BEFORE DELETE OR UPDATE ON "public"."questionnaire_versions" FOR EACH ROW EXECUTE FUNCTION "public"."questionnaire_version_guard"();



CREATE OR REPLACE TRIGGER "trg_questionnaire_versions_updated_at" BEFORE UPDATE ON "public"."questionnaire_versions" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



CREATE OR REPLACE TRIGGER "trg_questionnaires_updated_at" BEFORE UPDATE ON "public"."questionnaires" FOR EACH ROW EXECUTE FUNCTION "public"."handle_updated_at"();



ALTER TABLE ONLY "public"."attempt_alerts"
    ADD CONSTRAINT "attempt_alerts_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id");



ALTER TABLE ONLY "public"."attempt_alerts"
    ADD CONSTRAINT "attempt_alerts_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."attempt_answers"
    ADD CONSTRAINT "attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id");



ALTER TABLE ONLY "public"."attempt_details"
    ADD CONSTRAINT "attempt_details_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id");



ALTER TABLE ONLY "public"."attempt_results"
    ADD CONSTRAINT "attempt_results_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_questionnaire_code_fkey" FOREIGN KEY ("questionnaire_code") REFERENCES "public"."questionnaires"("code");



ALTER TABLE ONLY "public"."attempts"
    ADD CONSTRAINT "attempts_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "public"."questionnaire_versions"("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_created_by_profile_id_fkey" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payment_moves"
    ADD CONSTRAINT "payment_moves_from_client_id_fkey" FOREIGN KEY ("from_client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."payment_moves"
    ADD CONSTRAINT "payment_moves_moved_by_fkey" FOREIGN KEY ("moved_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payment_moves"
    ADD CONSTRAINT "payment_moves_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "public"."attempts"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_test_code_fkey" FOREIGN KEY ("test_code") REFERENCES "public"."questionnaires"("code");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."questionnaire_versions"
    ADD CONSTRAINT "questionnaire_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."questionnaire_versions"
    ADD CONSTRAINT "questionnaire_versions_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."questionnaire_versions"
    ADD CONSTRAINT "questionnaire_versions_questionnaire_code_fkey" FOREIGN KEY ("questionnaire_code") REFERENCES "public"."questionnaires"("code");



ALTER TABLE ONLY "public"."questionnaires"
    ADD CONSTRAINT "questionnaires_active_changed_by_fkey" FOREIGN KEY ("active_changed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE "public"."age_stops" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "age_stops_select" ON "public"."age_stops" FOR SELECT TO "authenticated" USING ("public"."can_view_payments"());



ALTER TABLE "public"."attempt_alerts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attempt_alerts_select" ON "public"."attempt_alerts" FOR SELECT USING ("public"."is_active_staff"());



ALTER TABLE "public"."attempt_answers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attempt_answers_select" ON "public"."attempt_answers" FOR SELECT USING ("public"."can_view_reports"());



ALTER TABLE "public"."attempt_details" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attempt_details_select" ON "public"."attempt_details" FOR SELECT USING ("public"."can_view_reports"());



ALTER TABLE "public"."attempt_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attempt_results_select" ON "public"."attempt_results" FOR SELECT USING ("public"."can_view_reports"());



ALTER TABLE "public"."attempts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attempts_select" ON "public"."attempts" FOR SELECT USING (("public"."is_active_staff"() OR ("client_id" IN ( SELECT "c"."id"
   FROM "public"."clients" "c"
  WHERE ("c"."auth_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_insert_policy" ON "public"."clients" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_active_staff"() OR ("auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "clients_select_policy" ON "public"."clients" FOR SELECT TO "authenticated" USING (("public"."is_active_staff"() OR ("auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "clients_update_policy" ON "public"."clients" FOR UPDATE TO "authenticated" USING (("public"."is_active_staff"() OR ("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK (("public"."is_active_staff"() OR ("auth_user_id" = ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."payment_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_events_select" ON "public"."payment_events" FOR SELECT TO "authenticated" USING ("public"."is_super_admin"());



ALTER TABLE "public"."payment_moves" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_moves_select" ON "public"."payment_moves" FOR SELECT TO "authenticated" USING ("public"."can_view_payments"());



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_select" ON "public"."payments" FOR SELECT TO "authenticated" USING (("public"."can_view_payments"() OR (EXISTS ( SELECT 1
   FROM "public"."clients" "c"
  WHERE (("c"."id" = "payments"."client_id") AND ("c"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_delete_policy" ON "public"."profiles" FOR DELETE TO "authenticated" USING ("public"."is_super_admin"());



CREATE POLICY "profiles_insert_policy" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "profiles_select_policy" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_super_admin"()));



CREATE POLICY "profiles_update_policy" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("public"."is_super_admin"() OR ("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK (("public"."is_super_admin"() OR (("auth_user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("role" = ( SELECT "profiles_1"."role"
   FROM "public"."profiles" "profiles_1"
  WHERE ("profiles_1"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))))));



ALTER TABLE "public"."questionnaire_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "questionnaire_versions_select" ON "public"."questionnaire_versions" FOR SELECT USING ("public"."is_active_staff"());



ALTER TABLE "public"."questionnaires" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "questionnaires_select" ON "public"."questionnaires" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."report_counters" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";





GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";
GRANT USAGE ON SCHEMA "public" TO "supabase_auth_admin";






















































































































































REVOKE ALL ON FUNCTION "public"."attempt_answer_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attempt_answer_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."attempt_answer_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."attempt_answer_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."attempt_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attempt_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."attempt_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."attempt_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."attempt_result_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attempt_result_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."attempt_result_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."attempt_result_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_payments"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_payments"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_payments"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."can_view_reports"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."can_view_reports"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_view_reports"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_paid_attempt"("p_client_id" "uuid", "p_code" "text", "p_version_id" "uuid", "p_payment_ref" "text", "p_paid_at" timestamp with time zone, "p_language" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_paid_attempt"("p_client_id" "uuid", "p_code" "text", "p_version_id" "uuid", "p_payment_ref" "text", "p_paid_at" timestamp with time zone, "p_language" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."custom_send_sms"("event" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."custom_send_sms"("event" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."custom_send_sms"("event" "jsonb") TO "supabase_auth_admin";



GRANT ALL ON FUNCTION "public"."get_current_staff_profile_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_current_staff_profile_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_current_staff_profile_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_staff"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_staff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_staff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_counsellor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_counsellor"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_counsellor"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."link_client_phone"("p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."link_client_phone"("p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_client_phone"("p_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."next_report_id"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."next_report_id"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."payment_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."payment_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."payment_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."payment_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."publish_questionnaire_version"("p_version_id" "uuid", "p_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."publish_questionnaire_version"("p_version_id" "uuid", "p_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."questionnaire_version_guard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."questionnaire_version_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."questionnaire_version_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."questionnaire_version_guard"() TO "service_role";


















GRANT ALL ON TABLE "public"."age_stops" TO "anon";
GRANT ALL ON TABLE "public"."age_stops" TO "authenticated";
GRANT ALL ON TABLE "public"."age_stops" TO "service_role";



GRANT ALL ON TABLE "public"."attempt_alerts" TO "anon";
GRANT ALL ON TABLE "public"."attempt_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."attempt_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."attempt_answers" TO "anon";
GRANT ALL ON TABLE "public"."attempt_answers" TO "authenticated";
GRANT ALL ON TABLE "public"."attempt_answers" TO "service_role";



GRANT ALL ON TABLE "public"."attempt_details" TO "anon";
GRANT ALL ON TABLE "public"."attempt_details" TO "authenticated";
GRANT ALL ON TABLE "public"."attempt_details" TO "service_role";



GRANT ALL ON TABLE "public"."attempt_results" TO "anon";
GRANT ALL ON TABLE "public"."attempt_results" TO "authenticated";
GRANT ALL ON TABLE "public"."attempt_results" TO "service_role";



GRANT ALL ON TABLE "public"."attempts" TO "anon";
GRANT ALL ON TABLE "public"."attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."attempts" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."payment_events" TO "anon";
GRANT ALL ON TABLE "public"."payment_events" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_events" TO "service_role";



GRANT ALL ON TABLE "public"."payment_moves" TO "anon";
GRANT ALL ON TABLE "public"."payment_moves" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_moves" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."questionnaire_versions" TO "anon";
GRANT ALL ON TABLE "public"."questionnaire_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."questionnaire_versions" TO "service_role";



GRANT ALL ON TABLE "public"."questionnaires" TO "anon";
GRANT ALL ON TABLE "public"."questionnaires" TO "authenticated";
GRANT ALL ON TABLE "public"."questionnaires" TO "service_role";



GRANT ALL ON TABLE "public"."report_counters" TO "anon";
GRANT ALL ON TABLE "public"."report_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."report_counters" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































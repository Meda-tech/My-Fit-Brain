'use server';

import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { normalizePhoneNumber } from '../phone';
import { ClientRecord } from '../types';
import { MAX_AGE, MIN_AGE, isGender, isRelationshipStatus } from '../options';
import { paymentDeps } from '../payments/server';
import { flagRefundForPhone } from '../payments/service';

export interface PhoneCheckResult {
  valid: boolean;
  normalized: string;
  formatted: string;
  exists: boolean;
  error?: string;
}

/**
 * Check whether a normalized phone belongs to an existing client record.
 * Does NOT expose any personal client information (name, age, etc.).
 */
export async function checkPhoneStatus(rawPhone: string): Promise<PhoneCheckResult> {
  const validation = normalizePhoneNumber(rawPhone);
  if (!validation.valid) {
    return {
      valid: false,
      normalized: '',
      formatted: rawPhone,
      exists: false,
      error: validation.error || 'Please enter a valid mobile number.',
    };
  }

  try {
    const adminClient = createAdminClient();
    const { data: client, error } = await adminClient
      .from('clients')
      .select('id')
      .eq('phone', validation.normalized)
      .maybeSingle();

    if (error) {
      console.error('Error checking phone status:', error);
    }

    return {
      valid: true,
      normalized: validation.normalized,
      formatted: validation.formatted,
      exists: !!client,
    };
  } catch (err) {
    console.error('Unexpected error checking phone:', err);
    return {
      valid: true,
      normalized: validation.normalized,
      formatted: validation.formatted,
      exists: false,
    };
  }
}

/**
 * Links a verified auth user to an existing pre-created client record.
 */
export interface LinkPhoneResult {
  success: boolean;
  status?: 'linked' | 'needs_registration';
  clientId?: string;
  error?: string;
}

export async function linkClientPhone(rawPhone: string): Promise<LinkPhoneResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized: Phone verification required.' };
  }

  const phoneValidation = normalizePhoneNumber(rawPhone || user.phone || '');
  const normalizedPhone = phoneValidation.valid
    ? phoneValidation.normalized
    : (rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`);
  const domesticDigits = normalizedPhone.replace(/\D/g, '');
  const tenDigits = domesticDigits.length >= 10 ? domesticDigits.slice(-10) : domesticDigits;

  try {
    const adminClient = createAdminClient();

    // Look for unlinked client record matching any format (+91, 91, or 10 digits)
    const { data: matchedRecord } = await adminClient
      .from('clients')
      .select('id, auth_user_id')
      .or(`phone.eq.${normalizedPhone},phone.eq.${domesticDigits},phone.eq.${tenDigits}`)
      .is('auth_user_id', null)
      .maybeSingle();

    if (matchedRecord) {
      const { error: updateErr } = await adminClient
        .from('clients')
        .update({
          auth_user_id: user.id,
          phone: normalizedPhone, // Standardize to +91 in DB
        })
        .eq('id', matchedRecord.id);

      if (updateErr) {
        console.error('Failed to link client phone:', updateErr);
        return { success: false, error: 'Something went wrong. Please try again.' };
      }

      return { success: true, status: 'linked', clientId: matchedRecord.id };
    }

    return { success: true, status: 'needs_registration' };
  } catch (err: unknown) {
    console.error('Unexpected error linking client phone:', err);
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}

export interface RegisterClientInput {
  fullName: string;
  gender: string;
  age: number;
  maritalStatus: string;
  city?: string;
  state?: string;
  email?: string;
}

// Error codes map to calm, translated messages in the UI. Raw database errors are only logged.
export type RegisterErrorCode =
  | 'fullName'
  | 'gender'
  | 'relationshipStatus'
  | 'age'
  | 'email'
  | 'phoneTaken'
  | 'generic';

export interface RegisterClientResult {
  success: boolean;
  /** Under 18: no client record (only the minimal age-stop record); the UI shows the AGE_STOP screen. */
  ageStop?: boolean;
  error?: RegisterErrorCode;
  client?: ClientRecord;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Creates client record for newly verified phone user.
 * Verified caller only. Uses verified phone from Supabase Auth user.
 * Validation here is the authority; the form mirrors it.
 */
export async function completeRegistration(
  input: RegisterClientInput
): Promise<RegisterClientResult> {
  // Age first: under 18 stops before any database call, whatever the UI sent.
  const age = Number(input.age);
  if (!Number.isInteger(age) || age < 1 || age > MAX_AGE) {
    return { success: false, error: 'age' };
  }
  if (age < MIN_AGE) {
    // No client record. A minimal record is kept (verified number, name, age entered, when) so the team
    // knows who came, and purchases paid with this number are flagged for a refund (Admin → Under 18,
    // Payments → Refund needed). Nothing else from the form is saved.
    try {
      const {
        data: { user },
      } = await (await createClient()).auth.getUser();
      const phone = user?.phone ? normalizePhoneNumber(user.phone) : null;
      if (user && phone?.valid) {
        const name = (input.fullName ?? '').trim().slice(0, 200);
        const { error } = await createAdminClient()
          .from('age_stops')
          .upsert(
            { phone: phone.normalized, full_name: name || null, age, auth_user_id: user.id, last_at: new Date().toISOString() },
            { onConflict: 'phone' }
          );
        if (error) console.error('Could not record the under-18 stop:', error.message);
        await flagRefundForPhone(paymentDeps(), phone.normalized);
      }
    } catch (err) {
      console.error('Could not record the under-18 stop:', err);
    }
    return { success: false, ageStop: true };
  }

  const fullName = (input.fullName ?? '').trim();
  if (fullName.length < 2) {
    return { success: false, error: 'fullName' };
  }

  if (!isGender(input.gender)) {
    return { success: false, error: 'gender' };
  }
  const gender = input.gender;

  if (!isRelationshipStatus(input.maritalStatus)) {
    return { success: false, error: 'relationshipStatus' };
  }
  const maritalStatus = input.maritalStatus;

  const email = input.email?.trim() || null;
  if (email && !EMAIL_PATTERN.test(email)) {
    return { success: false, error: 'email' };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user || !user.phone) {
    return { success: false, error: 'generic' };
  }

  const rawVerifiedPhone = user.phone;

  // Ensure normalized E.164 (+91XXXXXXXXXX) format is always used in DB
  const phoneValidation = normalizePhoneNumber(rawVerifiedPhone);
  const normalizedPhone = phoneValidation.valid
    ? phoneValidation.normalized
    : (rawVerifiedPhone.startsWith('+') ? rawVerifiedPhone : `+${rawVerifiedPhone}`);
  const domesticDigits = normalizedPhone.replace(/\D/g, '');
  const tenDigits = domesticDigits.length >= 10 ? domesticDigits.slice(-10) : domesticDigits;

  const details = {
    full_name: fullName,
    gender,
    age,
    marital_status: maritalStatus,
    city: input.city?.trim() || null,
    state: input.state?.trim() || null,
    email,
  };

  try {
    const adminClient = createAdminClient();

    // Double check if client record already exists for this phone (checking +91, 91, and 10 digits)
    const { data: existing } = await adminClient
      .from('clients')
      .select('id, auth_user_id')
      .or(`phone.eq.${normalizedPhone},phone.eq.${domesticDigits},phone.eq.${tenDigits}`)
      .maybeSingle();

    if (existing) {
      // If record exists and is unlinked, link it to this verified auth user
      if (!existing.auth_user_id) {
        const { data: updated, error: updateErr } = await adminClient
          .from('clients')
          .update({
            auth_user_id: user.id,
            phone: normalizedPhone, // Always standardize to +91 format in DB
            ...details,
          })
          .eq('id', existing.id)
          .select('*')
          .single();

        if (updateErr || !updated) {
          console.error('Failed to link client record:', updateErr);
          return { success: false, error: 'generic' };
        }
        return { success: true, client: updated as ClientRecord };
      }

      // If already linked to this user
      if (existing.auth_user_id === user.id) {
        return { success: true };
      }

      return { success: false, error: 'phoneTaken' };
    }

    // Insert brand new client record linked directly to verified auth user with +91 format
    const { data: newClient, error: insertError } = await adminClient
      .from('clients')
      .insert({
        auth_user_id: user.id,
        phone: normalizedPhone, // Always standardize to +91 format in DB
        ...details,
      })
      .select('*')
      .single();

    if (insertError || !newClient) {
      console.error('Failed to create client record:', insertError);
      return { success: false, error: 'generic' };
    }

    return { success: true, client: newClient as ClientRecord };
  } catch (err: unknown) {
    console.error('Unexpected error in completeRegistration:', err);
    return { success: false, error: 'generic' };
  }
}

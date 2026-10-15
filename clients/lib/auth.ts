import { createClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { redirect } from 'next/navigation';
import { ClientRecord } from './types';
import { normalizePhoneNumber } from './phone';

export interface CurrentClientSession {
  user: {
    id: string;
    phone?: string;
  };
  client: ClientRecord | null;
}

/**
 * Returns current authenticated Supabase user and their linked client record.
 */
export async function getCurrentClient(): Promise<CurrentClientSession | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }

  // 1. Fetch client record associated with this auth UID
  let { data: client } = await supabase
    .from('clients')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  // 2. If not linked yet, but user has verified phone, check if a staff pre-created record exists
  if (!client && user.phone) {
    try {
      const adminClient = createAdminClient();

      const phoneValidation = normalizePhoneNumber(user.phone);
      const normalizedPhone = phoneValidation.valid
        ? phoneValidation.normalized
        : (user.phone.startsWith('+') ? user.phone : `+${user.phone}`);
      const digitsOnly = normalizedPhone.replace(/\D/g, ''); // e.g. 919817285068
      const tenDigits = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly; // e.g. 9817285068

      // Search with admin privileges (bypassing RLS) for unlinked record matching any phone format
      const { data: matchedClient } = await adminClient
        .from('clients')
        .select('*')
        .or(`phone.eq.${normalizedPhone},phone.eq.${digitsOnly},phone.eq.${tenDigits}`)
        .is('auth_user_id', null)
        .maybeSingle();

      if (matchedClient) {
        // Link this verified auth user to the existing pre-created client record!
        const { data: updated } = await adminClient
          .from('clients')
          .update({
            auth_user_id: user.id,
            phone: normalizedPhone, // Standardize to +91 format in DB
          })
          .eq('id', matchedClient.id)
          .select('*')
          .single();

        if (updated) {
          client = updated;
        }
      }
    } catch (err) {
      console.error('Error linking pre-created client in getCurrentClient:', err);
    }
  }

  return {
    user: {
      id: user.id,
      phone: user.phone,
    },
    client: (client as ClientRecord) || null,
  };
}

/**
 * Enforces authenticated client session with complete client record.
 * Redirects to /login if unauthenticated, or to /register if record not yet completed.
 */
export async function requireClient(): Promise<{
  user: { id: string; phone?: string };
  client: ClientRecord;
}> {
  const session = await getCurrentClient();

  if (!session) {
    redirect('/login');
  }

  if (!session.client) {
    redirect('/register');
  }

  return {
    user: session.user,
    client: session.client,
  };
}

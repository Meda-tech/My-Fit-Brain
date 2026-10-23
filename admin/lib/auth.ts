import { cache } from 'react';
import { createClient } from './supabase/server';
import { redirect } from 'next/navigation';
import { Profile } from './types';

export interface CurrentStaffSession {
  user: {
    id: string;
    email?: string;
  };
  profile: Profile;
  isSuperAdmin: boolean;
  isCoordinator: boolean;
}

/**
 * Retrieves the current staff user and their verified database-backed profile.
 * Validates against public.profiles using auth_user_id mapping.
 *
 * getClaims() verifies the access token locally with the project's signing keys (no Auth server call;
 * with a legacy shared secret it asks the Auth server, like getUser()). cache(): one check per request,
 * however many services ask for the staff member while a page renders.
 */
export const getCurrentStaff = cache(async (): Promise<CurrentStaffSession | null> => {
  const supabase = await createClient();

  const { data, error: claimsError } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (claimsError || !claims?.sub) {
    return null;
  }
  const user = { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : undefined };

  // Fetch the staff profile associated with this auth UID
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .single();

  if (profileError || !profile || !profile.is_active) {
    return null;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    profile: profile as Profile,
    isSuperAdmin: profile.role === 'super_admin',
    isCoordinator: profile.role === 'coordinator',
  };
});

/**
 * Enforces that the current visitor is an authenticated, active staff member.
 * Redirects to /login if unauthorized.
 */
export async function requireStaff(): Promise<CurrentStaffSession> {
  const session = await getCurrentStaff();
  if (!session) {
    redirect('/login');
  }
  return session;
}

/**
 * Enforces that the current visitor is an active Super Admin.
 * Redirects if unauthorized.
 */
export async function requireSuperAdmin(): Promise<CurrentStaffSession> {
  const session = await requireStaff();
  if (!session.isSuperAdmin) {
    redirect('/dashboard?error=unauthorized_role');
  }
  return session;
}

import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { getCurrentStaff } from '../auth';
import { Profile } from '../types';
import { ROLE_LABELS, TEAM_ROLES, isTeamRole } from '../roles';

export interface CreateTeamMemberInput {
  email: string;
  fullName: string;
  password: string;
  role: string;
}

export interface TeamServiceResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

const teamRoles = [...TEAM_ROLES];

/**
 * List coordinators and counsellors. Only accessible to Super Admin.
 */
export async function listTeam(): Promise<Profile[]> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin) {
    throw new Error('Unauthorized: Only Super Admin can view the team.');
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .in('role', teamRoles)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to list team:', error);
    throw new Error('Database error while retrieving the team.');
  }

  return (data || []) as Profile[];
}

/**
 * Create a coordinator or counsellor account.
 * Super Admin privilege required. Provisions Auth user and linked profile.
 */
export async function createTeamMember(
  input: CreateTeamMemberInput
): Promise<TeamServiceResult<Profile>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin) {
    return { success: false, error: 'Unauthorized: Only Super Admin can add team members.' };
  }

  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const password = input.password;

  if (!isTeamRole(input.role)) {
    return { success: false, error: 'Please choose Coordinator or Counsellor.' };
  }
  const role = input.role;

  if (!email || !email.includes('@')) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  if (!fullName || fullName.length < 2) {
    return { success: false, error: 'Full name must be at least 2 characters.' };
  }

  if (!password || password.length < 8) {
    return { success: false, error: 'Password must be at least 8 characters long.' };
  }

  try {
    const adminClient = createAdminClient();

    // Check if profile with email already exists
    const { data: existingProfile } = await adminClient
      .from('profiles')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();

    if (existingProfile) {
      return { success: false, error: `An account with email ${email} already exists.` };
    }

    // 1. Create Supabase Auth User
    const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    });

    if (authError || !authUser.user) {
      console.error('Supabase Auth error creating team member:', authError);
      return { success: false, error: authError?.message || 'Failed to provision auth user.' };
    }

    // 2. Insert into profiles with stable application UUID
    const { data: profileData, error: profileError } = await adminClient
      .from('profiles')
      .insert({
        auth_user_id: authUser.user.id,
        email,
        full_name: fullName,
        role,
        is_active: true,
      })
      .select('*')
      .single();

    if (profileError || !profileData) {
      console.error('Failed to create profile row for team member:', profileError);
      // Rollback auth user creation if profile insert fails
      await adminClient.auth.admin.deleteUser(authUser.user.id);
      return { success: false, error: `Failed to record ${ROLE_LABELS[role].toLowerCase()} profile.` };
    }

    return { success: true, data: profileData as Profile };
  } catch (err: unknown) {
    console.error('Unexpected error in createTeamMember:', err);
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}

/**
 * Toggle active status of a coordinator or counsellor.
 */
export async function toggleTeamMemberStatus(
  profileId: string,
  isActive: boolean
): Promise<TeamServiceResult<Profile>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin) {
    return { success: false, error: 'Unauthorized: Only Super Admin can change team member status.' };
  }

  try {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', profileId)
      .in('role', teamRoles)
      .select('*')
      .single();

    if (error || !data) {
      return { success: false, error: 'Team member not found or update failed.' };
    }

    return { success: true, data: data as Profile };
  } catch (err: unknown) {
    console.error('Unexpected error in toggleTeamMemberStatus:', err);
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}

/**
 * Reset a coordinator's or counsellor's password.
 */
export async function resetTeamMemberPassword(
  profileId: string,
  newPassword: string
): Promise<TeamServiceResult<void>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin) {
    return { success: false, error: 'Unauthorized: Only Super Admin can reset team passwords.' };
  }

  if (!newPassword || newPassword.length < 8) {
    return { success: false, error: 'New password must be at least 8 characters long.' };
  }

  try {
    const adminClient = createAdminClient();

    const { data: profile, error: profileErr } = await adminClient
      .from('profiles')
      .select('auth_user_id')
      .eq('id', profileId)
      .in('role', teamRoles)
      .single();

    if (profileErr || !profile || !profile.auth_user_id) {
      return { success: false, error: 'Team member or linked auth identity not found.' };
    }

    const { error: authError } = await adminClient.auth.admin.updateUserById(
      profile.auth_user_id,
      { password: newPassword }
    );

    if (authError) {
      return { success: false, error: authError.message };
    }

    return { success: true };
  } catch (err: unknown) {
    console.error('Unexpected error in resetTeamMemberPassword:', err);
    return { success: false, error: 'Something went wrong. Please try again.' };
  }
}

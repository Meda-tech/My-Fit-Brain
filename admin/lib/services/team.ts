import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { getCurrentStaff } from '../auth';
import { Profile } from '../types';
import { ROLE_LABELS, TEAM_ROLES, isTeamRole } from '../roles';
import { presentationLabel } from '../booking';

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
    return { success: false, error: 'Please choose Coordinator, Counsellor or CRM.' };
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

/** Shown when a coordinator who still has clients would be made inactive (owner's words, 2026-11-20). */
export const MOVE_CLIENTS_FIRST = 'Move their clients first.';

/**
 * How many clients (phones) each coordinator has (client_coordinators). Super Admin only.
 * One counted query per coordinator, so no row limit applies.
 */
export async function coordinatorClientCounts(coordinatorIds: string[]): Promise<Record<string, number>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin || coordinatorIds.length === 0) return {};
  const adminClient = createAdminClient();
  const counts = await Promise.all(
    coordinatorIds.map(async (id) => {
      const { count, error } = await adminClient
        .from('client_coordinators')
        .select('phone', { count: 'exact', head: true })
        .eq('coordinator_id', id);
      if (error) throw new Error(`Could not count clients: ${error.message}`);
      return [id, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts);
}

/**
 * Move every client (phone) of one coordinator, with their purchases and payment attempts, to another active
 * coordinator. Super Admin only. Logged in coordinator_client_moves.
 */
export async function moveCoordinatorClients(
  fromId: string,
  toId: string
): Promise<TeamServiceResult<{ moved: number; toName: string }>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin) {
    return { success: false, error: 'Unauthorized: Only Super Admin can move clients.' };
  }
  if (!fromId || !toId || fromId === toId) {
    return { success: false, error: 'Choose another coordinator.' };
  }

  const adminClient = createAdminClient();
  const { data: to } = await adminClient
    .from('profiles')
    .select('full_name, role, is_active')
    .eq('id', toId)
    .maybeSingle();
  if (!to || to.role !== 'coordinator' || !to.is_active) {
    return { success: false, error: 'Choose an active coordinator.' };
  }

  const { data, error } = await adminClient.rpc('move_coordinator_clients', {
    p_from: fromId,
    p_to: toId,
    p_by: staff.profile.id,
  });
  if (error) {
    console.error('Failed to move coordinator clients:', error);
    return { success: false, error: 'The clients could not be moved. Please try again.' };
  }
  return { success: true, data: { moved: Number(data ?? 0), toName: to.full_name as string } };
}


/**
 * How many clients each counsellor has (client_counsellors: assigned by a booking or a move, not moved on).
 * Super Admin only. One counted query per counsellor.
 */
export async function counsellorClientCounts(counsellorIds: string[]): Promise<Record<string, number>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin || counsellorIds.length === 0) return {};
  const adminClient = createAdminClient();
  const counts = await Promise.all(
    counsellorIds.map(async (id) => {
      const { count, error } = await adminClient
        .from('client_counsellors')
        .select('id', { count: 'exact', head: true })
        .eq('counsellor_id', id)
        .is('ended_at', null);
      if (error) throw new Error(`Could not count clients: ${error.message}`);
      return [id, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts);
}

/**
 * How many clients (phones) each CRM has (client_crms). Super Admin only. One counted query per CRM.
 */
export async function crmClientCounts(crmIds: string[]): Promise<Record<string, number>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin || crmIds.length === 0) return {};
  const adminClient = createAdminClient();
  const counts = await Promise.all(
    crmIds.map(async (id) => {
      const { count, error } = await adminClient.from('client_crms').select('phone', { count: 'exact', head: true }).eq('crm_id', id);
      // Before the migration 20261124000000 the table does not exist: no counts.
      if (error) return [id, 0] as const;
      return [id, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts);
}

/**
 * Move every client (phone) of one CRM, with their Package purchases, to another active CRM. Super Admin only.
 * Logged in crm_client_moves.
 */
export async function moveCrmClients(fromId: string, toId: string): Promise<TeamServiceResult<{ moved: number; toName: string }>> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin) {
    return { success: false, error: 'Unauthorized: Only Super Admin can move clients.' };
  }
  if (!fromId || !toId || fromId === toId) {
    return { success: false, error: 'Choose another CRM.' };
  }
  const adminClient = createAdminClient();
  const { data: to } = await adminClient.from('profiles').select('full_name, role, is_active').eq('id', toId).maybeSingle();
  if (!to || to.role !== 'crm' || !to.is_active) {
    return { success: false, error: 'Choose an active CRM.' };
  }
  const { data, error } = await adminClient.rpc('move_crm_clients', { p_from: fromId, p_to: toId, p_by: staff.profile.id });
  if (error) {
    console.error('Failed to move CRM clients:', error);
    return { success: false, error: 'The clients could not be moved. Please try again.' };
  }
  return { success: true, data: { moved: Number(data ?? 0), toName: to.full_name as string } };
}

/** Shown when the new counsellor is not free at one of the upcoming presentations' times. */
export const MOVE_CLASH = 'The new counsellor is not free at some of these times. Pick another counsellor.';

interface ClashRow {
  on_date: string;
  start_time: string;
  end_time: string;
  client_name: string | null;
  client_phone: string | null;
}

/**
 * Move every client of one counsellor to another active counsellor: their access, and their upcoming booked
 * presentations at the same date and time (past ones keep their counsellor). Super Admin only. When the new counsellor
 * is not free at any of those times nothing moves and `clashes` lists them ("Client · Mon, 23 Nov 2026, 10:00–10:30 am").
 * Logged in counsellor_client_moves.
 */
export async function moveCounsellorClients(
  fromId: string,
  toId: string
): Promise<TeamServiceResult<{ clients: number; presentations: number; toName: string }> & { clashes?: string[] }> {
  const staff = await getCurrentStaff();
  if (!staff || !staff.isSuperAdmin) {
    return { success: false, error: 'Unauthorized: Only Super Admin can move clients.' };
  }
  if (!fromId || !toId || fromId === toId) {
    return { success: false, error: 'Choose another counsellor.' };
  }

  const adminClient = createAdminClient();
  const readClashes = async (): Promise<string[]> => {
    const { data, error } = await adminClient.rpc('counsellor_move_clashes', { p_from: fromId, p_to: toId });
    if (error) throw new Error(`Could not check the presentations: ${error.message}`);
    return ((data ?? []) as ClashRow[]).map(
      (r) => `${r.client_name ?? r.client_phone ?? 'Client'} · ${presentationLabel(r.on_date, r.start_time, r.end_time)}`
    );
  };

  const [{ data: to }, clashes] = await Promise.all([
    adminClient.from('profiles').select('full_name, role, is_active').eq('id', toId).maybeSingle(),
    readClashes(),
  ]);
  if (!to || to.role !== 'counsellor' || !to.is_active) {
    return { success: false, error: 'Choose an active counsellor.' };
  }
  if (clashes.length > 0) return { success: false, error: MOVE_CLASH, clashes };

  const { data, error } = await adminClient.rpc('move_counsellor_clients', {
    p_from: fromId,
    p_to: toId,
    p_by: staff.profile.id,
  });
  if (error) {
    // Someone booked the new counsellor meanwhile: the database refused, nothing moved.
    if (error.message.includes(MOVE_CLASH)) return { success: false, error: MOVE_CLASH, clashes: await readClashes() };
    console.error('Failed to move counsellor clients:', error);
    return { success: false, error: 'The clients could not be moved. Please try again.' };
  }
  const moved = (data ?? {}) as { clients?: number; presentations?: number };
  return {
    success: true,
    data: { clients: Number(moved.clients ?? 0), presentations: Number(moved.presentations ?? 0), toName: to.full_name as string },
  };
}

/**
 * Toggle active status of a coordinator, counsellor or CRM.
 * A coordinator, counsellor or CRM who still has clients cannot be made inactive: move their clients first. (The database
 * refuses it too, also for a counsellor with upcoming presentations.)
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

    if (!isActive) {
      const [asCoordinator, asCounsellor, asCrm] = await Promise.all([
        adminClient.from('client_coordinators').select('phone', { count: 'exact', head: true }).eq('coordinator_id', profileId),
        adminClient
          .from('client_counsellors')
          .select('id', { count: 'exact', head: true })
          .eq('counsellor_id', profileId)
          .is('ended_at', null),
        adminClient.from('client_crms').select('phone', { count: 'exact', head: true }).eq('crm_id', profileId),
      ]);
      if ((asCoordinator.count ?? 0) + (asCounsellor.count ?? 0) + (asCrm.count ?? 0) > 0) {
        return { success: false, error: MOVE_CLIENTS_FIRST };
      }
    }

    const { data, error } = await adminClient
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', profileId)
      .in('role', teamRoles)
      .select('*')
      .single();

    // The database refuses it too (trigger profiles_keep_clients), e.g. when a client arrived meanwhile.
    if (error?.message?.includes(MOVE_CLIENTS_FIRST)) {
      return { success: false, error: MOVE_CLIENTS_FIRST };
    }
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

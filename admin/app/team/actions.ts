'use server';

import {
  createTeamMember,
  toggleTeamMemberStatus,
  resetTeamMemberPassword,
  moveCoordinatorClients,
} from '../../lib/services/team';
import { ROLE_LABELS } from '../../lib/roles';
import { revalidatePath } from 'next/cache';

export interface TeamActionState {
  success: boolean;
  error?: string;
  message?: string;
}

export async function createTeamMemberAction(
  prevState: TeamActionState | null,
  formData: FormData
): Promise<TeamActionState> {
  const email = (formData.get('email') as string) || '';
  const fullName = (formData.get('fullName') as string) || '';
  const password = (formData.get('password') as string) || '';
  const role = (formData.get('role') as string) || '';

  const result = await createTeamMember({ email, fullName, password, role });

  if (!result.success || !result.data) {
    return { success: false, error: result.error || 'Failed to add team member.' };
  }

  revalidatePath('/team');
  revalidatePath('/dashboard');
  return {
    success: true,
    message: `${ROLE_LABELS[result.data.role]} ${result.data.full_name} added.`,
  };
}

export async function toggleStatusAction(
  profileId: string,
  newStatus: boolean
): Promise<TeamActionState> {
  const result = await toggleTeamMemberStatus(profileId, newStatus);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  revalidatePath('/team');
  revalidatePath('/dashboard');
  return { success: true };
}

export async function moveClientsAction(fromId: string, toId: string): Promise<TeamActionState> {
  const result = await moveCoordinatorClients(fromId, toId);
  if (!result.success || !result.data) {
    return { success: false, error: result.error || 'The clients could not be moved.' };
  }
  revalidatePath('/team');
  revalidatePath('/purchases');
  const { moved, toName } = result.data;
  return { success: true, message: `${moved} ${moved === 1 ? 'client' : 'clients'} moved to ${toName}.` };
}

export async function resetPasswordAction(
  profileId: string,
  newPassword: string
): Promise<TeamActionState> {
  const result = await resetTeamMemberPassword(profileId, newPassword);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  revalidatePath('/team');
  return { success: true, message: 'Password updated successfully.' };
}

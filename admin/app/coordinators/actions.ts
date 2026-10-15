'use server';

import {
  createTeamMember,
  toggleTeamMemberStatus,
  resetTeamMemberPassword,
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

  revalidatePath('/coordinators');
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
  revalidatePath('/coordinators');
  revalidatePath('/dashboard');
  return { success: true };
}

export async function resetPasswordAction(
  profileId: string,
  newPassword: string
): Promise<TeamActionState> {
  const result = await resetTeamMemberPassword(profileId, newPassword);
  if (!result.success) {
    return { success: false, error: result.error };
  }
  revalidatePath('/coordinators');
  return { success: true, message: 'Password updated successfully.' };
}

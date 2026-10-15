'use server';

import { createClientRecord } from '../../lib/services/clients';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export interface ActionState {
  success: boolean;
  error?: string;
  clientId?: string;
}

export async function createClientAction(
  prevState: ActionState | null,
  formData: FormData
): Promise<ActionState> {
  const fullName = (formData.get('fullName') as string) || '';
  const phone = (formData.get('phone') as string) || '';
  const gender = (formData.get('gender') as string) || '';
  const age = Number(formData.get('age'));
  const maritalStatus = (formData.get('maritalStatus') as string) || '';
  const city = (formData.get('city') as string) || undefined;
  const state = (formData.get('state') as string) || undefined;
  const email = (formData.get('email') as string) || undefined;

  const result = await createClientRecord({
    fullName,
    phone,
    gender,
    age,
    maritalStatus,
    city,
    state,
    email,
  });

  if (!result.success || !result.data) {
    return {
      success: false,
      error: result.error || 'Failed to create client record.',
    };
  }

  revalidatePath('/clients');
  revalidatePath('/dashboard');
  redirect(`/clients/${result.data.id}`);
}

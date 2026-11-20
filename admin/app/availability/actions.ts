'use server';

import { revalidatePath } from 'next/cache';
import { addAvailabilityChange, removeAvailabilityChange, type AddChangeInput } from '../../lib/services/availability';

export async function addAvailabilityAction(input: AddChangeInput): Promise<{ success: boolean; error?: string }> {
  const result = await addAvailabilityChange(input);
  if (result.success) revalidatePath('/availability');
  return result;
}

export async function undoAvailabilityAction(changeId: string): Promise<{ success: boolean; error?: string }> {
  const result = await removeAvailabilityChange(changeId);
  if (result.success) revalidatePath('/availability');
  return result;
}

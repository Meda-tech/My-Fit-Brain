'use server';

import { revalidatePath } from 'next/cache';
import { markCall, type MarkCallInput } from '../../lib/services/calls';

export async function markCallAction(input: MarkCallInput): Promise<{ success: boolean; error?: string }> {
  const result = await markCall(input);
  if (result.success) {
    revalidatePath('/tasks');
    revalidatePath('/purchases');
  }
  return result;
}

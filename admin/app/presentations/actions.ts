'use server';

import { revalidatePath } from 'next/cache';
import { markPresentationDone } from '../../lib/services/presentations';

export async function markPresentationDoneAction(bookingId: string): Promise<{ success: boolean; error?: string }> {
  const result = await markPresentationDone(bookingId);
  if (result.success) {
    revalidatePath('/presentations');
    revalidatePath('/tasks');
    revalidatePath('/purchases');
  }
  return result;
}

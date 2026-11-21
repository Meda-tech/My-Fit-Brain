'use server';

import { revalidatePath } from 'next/cache';
import { activeCounsellors, markPresentationDone, markPresentationDoneByAdmin } from '../../lib/services/presentations';

export async function markPresentationDoneAction(bookingId: string): Promise<{ success: boolean; error?: string }> {
  const result = await markPresentationDone(bookingId);
  if (result.success) {
    revalidatePath('/presentations');
    revalidatePath('/tasks');
    revalidatePath('/purchases');
  }
  return result;
}

/** The active counsellors, read when the "Mark report presentation done" dialog opens (super admins). */
export async function activeCounsellorsAction(): Promise<{ id: string; full_name: string }[]> {
  return activeCounsellors();
}

/** Old purchase: a super admin marks the report presentation done (counsellor + the date it happened, no slot). */
export async function markPresentationDoneByAdminAction(input: {
  purchaseId: string;
  counsellorId: string;
  date: string;
}): Promise<{ success: boolean; error?: string }> {
  const result = await markPresentationDoneByAdmin(input);
  if (result.success) {
    revalidatePath('/presentations');
    revalidatePath('/tasks');
    revalidatePath('/purchases');
  }
  return result;
}

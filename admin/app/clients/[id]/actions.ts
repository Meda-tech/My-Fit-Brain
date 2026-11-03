'use server';

import { revalidatePath } from 'next/cache';
import { recordOfflinePayment, referenceUses, type RecordResult } from '../../../lib/services/offline-payments';

// "Add offline payment" on the client profile (the service checks the role). Errors come back as
// plain sentences.

export async function recordOfflinePaymentAction(clientId: string, form: FormData): Promise<RecordResult> {
  const result = await recordOfflinePayment(clientId, form);
  if (result.ok) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath('/payments');
  }
  return result;
}

/** Warning only (never blocks): how many other payments already use this reference. */
export async function referenceUsedAction(reference: string): Promise<number> {
  if (typeof reference !== 'string' || reference.length > 200) return 0;
  return (await referenceUses(reference)).length;
}

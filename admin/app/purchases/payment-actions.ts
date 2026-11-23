'use server';

import { revalidatePath } from 'next/cache';
import { recordAssessmentPayment, type RecordResult } from '../../lib/services/offline-payments';

/** "Add assessment payment" on an unpaid row (My tasks Payment call, purchase side panel). The service checks the role. */
export async function recordAssessmentPaymentAction(purchaseId: string, form: FormData): Promise<RecordResult> {
  if (typeof purchaseId !== 'string') return { ok: false, error: 'This purchase was not found.' };
  const result = await recordAssessmentPayment(purchaseId, form);
  if (result.ok) {
    revalidatePath('/tasks');
    revalidatePath('/purchases');
    revalidatePath('/payments');
  }
  return result;
}

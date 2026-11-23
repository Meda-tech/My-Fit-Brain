'use server';

import { revalidatePath } from 'next/cache';
import { closePurchase, type ClosePurchaseResult } from '../../lib/services/purchases';

/** "Close purchase" (super admins; coordinators for their own clients). */
export async function closePurchaseAction(purchaseId: string, reason: string): Promise<ClosePurchaseResult> {
  if (typeof purchaseId !== 'string' || typeof reason !== 'string') return { success: false, error: 'This purchase was not found.' };
  const result = await closePurchase(purchaseId, reason);
  if (result.success) {
    revalidatePath('/purchases');
    revalidatePath('/tasks');
  }
  return result;
}

'use server';

import { revalidatePath } from 'next/cache';
import { markRefunded, movePurchase } from '../../lib/services/payments';

// Staff actions on a purchase (the service checks the role). Errors come back as plain sentences.

export async function movePurchaseAction(paymentId: string, phone: string): Promise<{ error: string | null }> {
  const error = await movePurchase(paymentId, phone);
  if (!error) revalidatePath('/payments');
  return { error };
}

export async function markRefundedAction(paymentId: string): Promise<{ error: string | null }> {
  const error = await markRefunded(paymentId);
  if (!error) revalidatePath('/payments');
  return { error };
}

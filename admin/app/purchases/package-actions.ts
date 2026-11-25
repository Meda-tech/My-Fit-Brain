'use server';

import { revalidatePath } from 'next/cache';
import {
  packageBalanceFor,
  packageReferenceUses,
  recordPackagePayment,
  savePackage,
  savePackageAmounts,
  type RecordPackageResult,
} from '../../lib/services/packages';
import type { PackageBalance } from '../../lib/package';

/**
 * The package balance for "Add package payment" (package amount, paid so far, remaining, first minimum, start
 * amount; calculated by the database), or null when this staff member cannot add a payment for it now.
 */
export async function packageBalanceAction(purchaseId: string): Promise<PackageBalance | null> {
  if (typeof purchaseId !== 'string') return null;
  return packageBalanceFor(purchaseId);
}

export async function recordPackagePaymentAction(purchaseId: string, form: FormData): Promise<RecordPackageResult> {
  const result = await recordPackagePayment(purchaseId, form);
  if (result.ok) {
    revalidatePath('/purchases');
    revalidatePath('/tasks');
    revalidatePath('/payments/packages');
    revalidatePath('/crm');
  }
  return result;
}

/** Warning only (never blocks): how many other payments already use this reference. */
export async function packageReferenceUsedAction(reference: string): Promise<number> {
  if (typeof reference !== 'string' || reference.length > 200) return 0;
  return packageReferenceUses(reference);
}

export async function savePackageAction(fields: { name: string; sessions: string; frequency: string; price: string }): Promise<{ success: boolean; error?: string }> {
  const result = await savePackage(fields);
  if (result.success) revalidatePath('/settings');
  return result;
}

/** Package amounts (super admins): first payment minimum, start amount, milestones; all typed in rupees. */
export async function savePackageAmountsAction(fields: {
  firstMin: string;
  start: string;
  milestones: { session: string; amount: string }[];
}): Promise<{ success: boolean; error?: string }> {
  const result = await savePackageAmounts(fields);
  if (result.success) {
    revalidatePath('/settings');
    revalidatePath('/purchases');
    revalidatePath('/tasks');
    revalidatePath('/crm');
  }
  return result;
}

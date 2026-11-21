'use server';

import { revalidatePath } from 'next/cache';
import { bookPresentation, cancelBooking, freeSlots, type BookInput } from '../../lib/services/booking';
import type { FreeDay } from '../../lib/booking';

export async function freeSlotsAction(): Promise<{ days: FreeDay[]; error?: string }> {
  try {
    return { days: await freeSlots() };
  } catch {
    return { days: [], error: 'The free slots could not be loaded. Please try again.' };
  }
}

function refresh() {
  revalidatePath('/tasks');
  revalidatePath('/purchases');
  revalidatePath('/availability');
}

export async function bookPresentationAction(input: BookInput): Promise<{ success: boolean; error?: string }> {
  const result = await bookPresentation(input);
  if (result.success) refresh();
  return result;
}

export async function cancelBookingAction(bookingId: string, reason: string): Promise<{ success: boolean; error?: string }> {
  const result = await cancelBooking(bookingId, reason);
  if (result.success) refresh();
  return result;
}

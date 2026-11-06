'use server';

import { revalidatePath } from 'next/cache';
import { saveConclusion } from '../../../lib/services/conclusions';
import { draftConclusion } from '../../../lib/services/ai-conclusion';
import type { Conclusion } from '../../../lib/conclusion';

// The counsellor's conclusion (the service checks the role). Errors come back as plain sentences.
export async function saveConclusionAction(
  attemptId: string,
  body: string,
  expectedUpdatedAt: string | null
): Promise<{ error: string | null; conclusion?: Conclusion }> {
  const result = await saveConclusion(attemptId, body, expectedUpdatedAt);
  if (!result.error) {
    revalidatePath(`/attempts/${attemptId}`);
    revalidatePath('/assessments');
  }
  return result;
}

// "Draft with AI": returns text for the editor; nothing is saved until the counsellor presses Save.
export async function draftConclusionAction(attemptId: string): Promise<{ error: string | null; body?: string }> {
  return draftConclusion(attemptId);
}

'use server';

import { redirect } from 'next/navigation';
import { currentClient, serviceDeps } from '../../lib/assessment/server';
import * as service from '../../lib/assessment/service';
import { AssessmentError, type AnswerValue, type Interrupt, type Step } from '../../lib/assessment/types';

// Server actions for the assessment screens. Each one resolves the signed-in client; the service checks
// that the attempt is theirs and uses its pinned version. Errors come back as codes, never stack traces.

export type ActionError = { ok: false; code: string };

function failure(err: unknown): ActionError {
  if (err instanceof AssessmentError) return { ok: false, code: err.code };
  console.error('Assessment action failed:', err);
  return { ok: false, code: 'ERROR' };
}

export async function startPurchaseAction(formData: FormData): Promise<void> {
  const client = await currentClient();
  const testCode = String(formData.get('testCode') ?? '');
  let attemptId: string;
  try {
    attemptId = (await service.startPurchase(serviceDeps(), client, testCode)).id;
  } catch (err) {
    const code = err instanceof AssessmentError ? err.code : 'ERROR';
    if (!(err instanceof AssessmentError)) console.error('Purchase failed:', err);
    redirect(`/payment/${encodeURIComponent(testCode)}?error=${code}`);
  }
  redirect(`/assessment/${attemptId}`);
}

export async function giveConsentAction(formData: FormData): Promise<void> {
  const client = await currentClient();
  const attemptId = String(formData.get('attemptId') ?? '');
  await service.giveConsent(serviceDeps(), client, attemptId);
  redirect(`/assessment/${attemptId}`);
}

export async function saveAnswerAction(
  attemptId: string,
  qid: string,
  value: AnswerValue
): Promise<{ ok: true; step: Step; interrupt: Interrupt | null } | ActionError> {
  try {
    const client = await currentClient();
    const r = await service.saveAnswer(serviceDeps(), client, attemptId, qid, value);
    return { ok: true, step: r.step, interrupt: r.interrupt };
  } catch (err) {
    return failure(err);
  }
}

export async function goBackAction(attemptId: string, fromQid: string | null): Promise<{ ok: true; step: Step } | ActionError> {
  try {
    const client = await currentClient();
    return { ok: true, step: await service.goBack(serviceDeps(), client, attemptId, fromQid) };
  } catch (err) {
    return failure(err);
  }
}

export async function submitAction(attemptId: string): Promise<{ ok: true; status: 'completed' | 'stopped' } | ActionError> {
  try {
    const client = await currentClient();
    const r = await service.submit(serviceDeps(), client, attemptId);
    return { ok: true, status: r.status };
  } catch (err) {
    return failure(err);
  }
}

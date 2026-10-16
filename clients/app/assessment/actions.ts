'use server';

import { redirect } from 'next/navigation';
import type { Answers } from '@mfb/engine';
import { currentClient, forgetAttempt, serviceDeps } from '../../lib/assessment/server';
import * as service from '../../lib/assessment/service';
import { AssessmentError, type AnswerValue, type Interrupt, type Step } from '../../lib/assessment/types';

// Server actions for the assessment screens. Each one resolves the signed-in client; the service checks
// that the attempt is theirs and uses its pinned version. Errors come back as codes, never stack traces.
// Answers are buffered in the browser and sent as a draft with every call (see service.ts, Questions).

export type ActionError = { ok: false; code: string };

function failure(err: unknown, attemptId?: string): ActionError {
  if (attemptId) forgetAttempt(attemptId);
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

export async function answerAction(
  attemptId: string,
  draft: Answers,
  qid: string,
  value: AnswerValue,
  flush: boolean
): Promise<{ ok: true; step: Step; interrupt: Interrupt | null; answers: Answers; saved: boolean } | ActionError> {
  try {
    const client = await currentClient();
    const r = await service.answer(serviceDeps({ cached: true }), client, attemptId, draft, qid, value, { flush });
    return { ok: true, ...r };
  } catch (err) {
    return failure(err, attemptId);
  }
}

export async function backAction(attemptId: string, draft: Answers, fromQid: string | null): Promise<{ ok: true; step: Step } | ActionError> {
  try {
    const client = await currentClient();
    return { ok: true, step: await service.back(serviceDeps({ cached: true }), client, attemptId, draft, fromQid) };
  } catch (err) {
    return failure(err, attemptId);
  }
}

export async function submitAction(
  attemptId: string,
  draft: Answers
): Promise<{ ok: true; status: 'completed' | 'stopped' } | ActionError> {
  try {
    const client = await currentClient();
    const r = await service.submit(serviceDeps(), client, attemptId, draft);
    return { ok: true, status: r.status };
  } catch (err) {
    return failure(err, attemptId);
  }
}

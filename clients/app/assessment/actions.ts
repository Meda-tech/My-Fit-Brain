'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { currentClient, serviceDeps } from '../../lib/assessment/server';
import * as service from '../../lib/assessment/service';
import { AssessmentError, type At, type Interrupt, type Step } from '../../lib/assessment/types';
import { LANG_COOKIE, parseLang } from '../../lib/lang-cookie';

// Server actions for the assessment screens. Each one resolves the signed-in client; the service checks
// that the attempt is theirs and uses its pinned version. Errors come back as codes, never stack traces.

export type ActionError = { ok: false; code: string };

function failure(err: unknown): ActionError {
  if (err instanceof AssessmentError) return { ok: false, code: err.code };
  console.error('Assessment action failed:', err);
  return { ok: false, code: 'ERROR' };
}

export async function giveConsentAction(formData: FormData): Promise<void> {
  const client = await currentClient();
  const attemptId = String(formData.get('attemptId') ?? '');
  await service.giveConsent(serviceDeps(), client, attemptId);
  redirect(`/assessment/${attemptId}`);
}

export async function answerAction(
  attemptId: string,
  questionId: string,
  chosen: string[]
): Promise<{ ok: true; step: Step; interrupt: Interrupt | null } | ActionError> {
  try {
    const client = await currentClient();
    const r = await service.answer(serviceDeps(), client, attemptId, questionId, chosen);
    return { ok: true, ...r };
  } catch (err) {
    return failure(err);
  }
}

export async function answerDetailAction(
  attemptId: string,
  detailId: string,
  text: string
): Promise<{ ok: true; step: Step; interrupt: Interrupt | null } | ActionError> {
  try {
    const client = await currentClient();
    const r = await service.answerDetail(serviceDeps(), client, attemptId, detailId, text);
    return { ok: true, ...r };
  } catch (err) {
    return failure(err);
  }
}

export async function backAction(attemptId: string, from: At): Promise<{ ok: true; step: Step } | ActionError> {
  try {
    const client = await currentClient();
    return { ok: true, step: await service.back(serviceDeps(), client, attemptId, from) };
  } catch (err) {
    return failure(err);
  }
}

/** Submits in the language the client is using right now (the report is built in that language). */
export async function submitAction(attemptId: string): Promise<{ ok: true } | ActionError> {
  try {
    const client = await currentClient();
    const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
    await service.submit(serviceDeps(), client, attemptId, lang);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

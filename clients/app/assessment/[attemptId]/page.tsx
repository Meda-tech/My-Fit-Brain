import { notFound } from 'next/navigation';
import { attemptDetails, currentClient, serviceDeps } from '../../../lib/assessment/server';
import { paymentReceipt } from '../../../lib/payments/server';
import { openRunner } from '../../../lib/assessment/service';
import type { Answers } from '@mfb/engine';
import { AssessmentError, type Step } from '../../../lib/assessment/types';
import { PageChrome } from '../../../components/PageChrome';
import { AssessmentShell } from './AssessmentShell';

export const dynamic = 'force-dynamic';

// One URL for the whole assessment (no test name in it). The server decides the step; ?q= reopens an
// earlier question after "Back".
export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const client = await currentClient();
  const { attemptId } = await params;
  const { q } = await searchParams;

  let step: Step;
  let answers: Answers;
  try {
    ({ step, answers } = await openRunner(serviceDeps(), client, attemptId, q ?? null));
  } catch (err) {
    if (err instanceof AssessmentError && err.code === 'NOT_FOUND') notFound();
    throw err;
  }

  const completed =
    step.kind === 'completed'
      ? await Promise.all([attemptDetails(client, attemptId), paymentReceipt(client, attemptId)]).then(([d, receipt]) =>
          d ? { ...d, receipt } : null
        )
      : null;

  return (
    <PageChrome nav={step.kind === 'completed'}>
      <AssessmentShell attemptId={attemptId} initialStep={step} initialAnswers={answers} completed={completed} />
    </PageChrome>
  );
}

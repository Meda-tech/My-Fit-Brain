import { notFound } from 'next/navigation';
import { attemptDetails, currentClient, serviceDeps } from '../../../lib/assessment/server';
import { paymentReceipt } from '../../../lib/payments/server';
import { openRunner } from '../../../lib/assessment/service';
import { AssessmentError, type At, type Step } from '../../../lib/assessment/types';
import { PageChrome } from '../../../components/PageChrome';
import { AssessmentShell } from './AssessmentShell';

export const dynamic = 'force-dynamic';

// One URL for the whole assessment (no test name in it). The server decides the step; ?q= (a question)
// or ?d= (a client-details question) reopens an earlier one after "Back".
export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ q?: string; d?: string }>;
}) {
  const client = await currentClient();
  const { attemptId } = await params;
  const { q, d } = await searchParams;
  const at: At = d ? { kind: 'detail', id: d } : q ? { kind: 'question', id: q } : null;

  let step: Step;
  try {
    step = await openRunner(serviceDeps(), client, attemptId, at);
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
      <AssessmentShell attemptId={attemptId} initialStep={step} completed={completed} />
    </PageChrome>
  );
}

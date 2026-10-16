import { notFound, redirect } from 'next/navigation';
import { currentClient, serviceDeps } from '../../../lib/assessment/server';
import { getStep } from '../../../lib/assessment/service';
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
  try {
    step = await getStep(serviceDeps(), client, attemptId, q ?? null);
  } catch (err) {
    if (err instanceof AssessmentError && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  if (step.kind === 'completed') redirect(`/report/${attemptId}`);

  return (
    <PageChrome nav={false}>
      <AssessmentShell attemptId={attemptId} initialStep={step} />
    </PageChrome>
  );
}

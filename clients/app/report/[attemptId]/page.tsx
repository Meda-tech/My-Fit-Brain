import { notFound, redirect } from 'next/navigation';
import { currentClient, storedReport } from '../../../lib/assessment/server';
import { AssessmentError } from '../../../lib/assessment/types';
import { PageChrome } from '../../../components/PageChrome';
import { ClientReport } from './ClientReport';

export const dynamic = 'force-dynamic';

// The web report, built only from the stored result (never re-scored here).
export default async function ReportPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const client = await currentClient();
  const { attemptId } = await params;

  let stored: Awaited<ReturnType<typeof storedReport>>;
  try {
    stored = await storedReport(client, attemptId);
  } catch (err) {
    if (err instanceof AssessmentError && err.code === 'NOT_FOUND') notFound();
    throw err;
  }
  if (!stored) redirect(`/assessment/${attemptId}`);

  return (
    <PageChrome width="report">
      <ClientReport doc={stored.report} />
    </PageChrome>
  );
}

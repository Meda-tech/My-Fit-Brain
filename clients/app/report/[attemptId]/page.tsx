import { notFound, redirect } from 'next/navigation';
import { ReportView } from '@mfb/report';
import { currentClient, storedReport } from '../../../lib/assessment/server';
import { AssessmentError } from '../../../lib/assessment/types';
import { translations } from '../../../lib/i18n';
import { Logo } from '../../../components/brand';
import { PageChrome } from '../../../components/PageChrome';

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

  const labels = {
    en: { reportId: translations.en.assess.reportId, date: translations.en.assess.date },
    hi: { reportId: translations.hi.assess.reportId, date: translations.hi.assess.date },
  };

  return (
    <PageChrome width="report">
      <ReportView
        doc={stored.report}
        logo={<Logo variant="endorsed" tone="colour" width={220} />}
        seal={<Logo variant="seal" tone="colour" width={96} />}
        labels={labels}
      />
    </PageChrome>
  );
}

import { notFound } from 'next/navigation';
import { ReportView } from '@mfb/report';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { AttemptStatusPill, formatDateTime } from '../../../components/attempts/AttemptStatusPill';
import { CounsellorView } from '../../../components/attempts/CounsellorView';
import { AttemptTabs } from '../../../components/attempts/AttemptTabs';
import { DownloadPdfButton } from '../../../components/attempts/DownloadPdfButton';
import { canViewReports, getAttemptDetail } from '../../../lib/services/attempts';
import { loadVersionConfig } from '../../../lib/question-bank/data';
import { Lock } from 'lucide-react';
import { Card, Logo, Notice, Pill } from '../../../components/brand';

export const dynamic = 'force-dynamic';

// Reports are read by the care team in English only.
const LABELS = {
  en: { reportId: 'Report ID', date: 'Date' },
  hi: { reportId: 'Report ID', date: 'Date' },
};

export default async function AttemptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { profile } = await requireStaff();
  const { id } = await params;
  const { view } = await searchParams;
  const detail = await getAttemptDetail(id);
  if (!detail) notFound();
  const { attempt } = detail;
  const withReport = canViewReports(profile.role);
  const config = withReport ? await loadVersionConfig(attempt.version_id).catch(() => null) : null;

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <div className="print:hidden">
        <PageHeader
          back={{ href: `/clients/${attempt.client_id}`, label: `Back to ${detail.clientName ?? 'client'}` }}
          eyebrow={
            <>
              <Pill tone="quiet">{attempt.test_name}</Pill>
              <AttemptStatusPill status={attempt.status} />
            </>
          }
          title={<span className="font-mono">{attempt.report_id}</span>}
          description={
            <>
              Version {attempt.version_label} · paid {formatDateTime(attempt.paid_at)}
              {attempt.payment_mode === 'stub' ? ' (test payment)' : attempt.payment_ref ? ` (Razorpay ${attempt.payment_ref})` : ''} · completed {formatDateTime(attempt.completed_at)}
            </>
          }
        />
      </div>

      {withReport ? (
        <AttemptTabs
          initial={view === 'counsellor' ? 'counsellor' : 'report'}
          alerts={detail.events.length}
          report={
            detail.report ? (
              <div className="max-w-190">
                <div className="mb-4 flex justify-end print:hidden">
                  <DownloadPdfButton attemptId={attempt.id} reportId={attempt.report_id} />
                </div>
                <ReportView
                  doc={detail.report}
                  lang="en"
                  preparedFor={{ name: detail.clientName ?? 'Client', testName: attempt.test_name }}
                  logo={<Logo variant="endorsed" tone="colour" width={220} />}
                  seal={<Logo variant="seal" tone="colour" width={96} />}
                  labels={LABELS}
                />
              </div>
            ) : (
              <Card className="max-w-202 p-5 text-[15px] text-ink-muted">The report appears here once the client finishes.</Card>
            )
          }
          counsellor={
            <div className="max-w-240">
              <CounsellorView result={detail.result} config={config} answers={detail.answers} events={detail.events} />
            </div>
          }
        />
      ) : (
        <div className="max-w-202 space-y-6">
          <Notice variant="info" icon={<Lock size={18} strokeWidth={2} aria-hidden />}>
            Reports and answers are visible to counsellors and super admins only.
          </Notice>
          <CounsellorView result={null} config={null} answers={[]} events={detail.events} eventsOnly />
        </div>
      )}
    </AdminShell>
  );
}

import { notFound } from 'next/navigation';
import { ReportView } from '@mfb/report';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { AttemptStatusPill, formatDateTime } from '../../../components/attempts/AttemptStatusPill';
import { CounsellorView } from '../../../components/attempts/CounsellorView';
import { getAttemptDetail } from '../../../lib/services/attempts';
import { loadVersionConfig } from '../../../lib/question-bank/data';
import { Card, Logo, Pill } from '../../../components/brand';

export const dynamic = 'force-dynamic';

// Same report labels as the client app.
const LABELS = {
  en: { reportId: 'Report ID', date: 'Date' },
  hi: { reportId: 'रिपोर्ट ID', date: 'तारीख' },
};

export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireStaff();
  const { id } = await params;
  const detail = await getAttemptDetail(id);
  if (!detail) notFound();
  const { attempt } = detail;
  const config = await loadVersionConfig(attempt.version_id).catch(() => null);

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
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
            {attempt.payment_mode === 'stub' ? ' (test payment)' : ''} · completed {formatDateTime(attempt.completed_at)}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,808px)_minmax(0,1fr)]">
        <div>
          <h2 className="mb-3 text-[14px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Client report</h2>
          {detail.report ? (
            <ReportView
              doc={detail.report}
              logo={<Logo variant="endorsed" tone="colour" width={220} />}
              seal={<Logo variant="seal" tone="colour" width={96} />}
              labels={LABELS}
            />
          ) : (
            <Card className="p-5 text-[15px] text-ink-muted">The report appears here once the client finishes.</Card>
          )}
        </div>
        <CounsellorView result={detail.result} config={config} answers={detail.answers} events={detail.events} />
      </div>
    </AdminShell>
  );
}

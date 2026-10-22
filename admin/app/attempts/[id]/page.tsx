import { notFound } from 'next/navigation';
import { Lock } from 'lucide-react';
import { counsellorView } from '@mfb/questionnaire';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { AttemptStatusPill, formatDateTime } from '../../../components/attempts/AttemptStatusPill';
import { AlertsList, CounsellorView } from '../../../components/attempts/CounsellorView';
import { DownloadPdfButton } from '../../../components/attempts/DownloadPdfButton';
import { canViewReports, getAttemptDetail } from '../../../lib/services/attempts';
import { Card, Notice, Pill } from '../../../components/brand';

export const dynamic = 'force-dynamic';

// One attempt: the counsellor view and the PDF download (super admins and counsellors). Coordinators see
// the alerts only. The client never sees any of this.
export default async function AttemptPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireStaff();
  const { id } = await params;
  const detail = await getAttemptDetail(id);
  if (!detail) notFound();
  const { attempt } = detail;
  const withReport = canViewReports(profile.role);
  const view = withReport && detail.definition && detail.answers ? counsellorView(detail.definition, detail.answers, detail.result) : null;

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        back={{ href: `/clients/${attempt.client_id}`, label: `Back to ${detail.clientName ?? 'client'}` }}
        eyebrow={
          <>
            <Pill tone="quiet">{attempt.questionnaire_name}</Pill>
            <AttemptStatusPill status={attempt.status} />
          </>
        }
        title={<span className="font-mono">{attempt.report_id}</span>}
        description={
          <>
            {detail.clientName ?? 'Client'} · version {attempt.version_number ?? '—'} · paid {formatDateTime(attempt.paid_at)} · completed{' '}
            {formatDateTime(attempt.completed_at)} · {attempt.language === 'hi' ? 'Hindi' : 'English'}
          </>
        }
        actions={withReport && detail.report ? <DownloadPdfButton attemptId={attempt.id} reportId={attempt.report_id} /> : undefined}
      />

      {withReport ? (
        <div className="max-w-240">
          {detail.result && !view && (
            <Notice variant="info" className="mb-6">
              The questionnaire version of this assessment could not be read, so only the stored result is available.
            </Notice>
          )}
          <CounsellorView view={view} alerts={detail.alerts} />
        </div>
      ) : (
        <div className="max-w-202 space-y-6">
          <Notice variant="info" icon={<Lock size={18} strokeWidth={2} aria-hidden />}>
            Answers, results and the PDF are visible to counsellors and super admins only.
          </Notice>
          <Card className="p-5 sm:p-6">
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">Safety alerts</h3>
            <AlertsList alerts={detail.alerts} />
          </Card>
        </div>
      )}
    </AdminShell>
  );
}

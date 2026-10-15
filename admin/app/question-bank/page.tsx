import Link from 'next/link';
import { ChevronRight, Database, FileUp, Lock } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { ButtonLink, Card, Notice, Pill } from '../../components/brand';
import { contentRights, formatDateTime, loadOverview, type TestOverview } from '../../lib/question-bank/data';
import { StartVersionForm } from './StartVersionForm';
import { StatusPill } from './StatusPill';

export const dynamic = 'force-dynamic';

/** Next minor version after the newest label, e.g. 1.1 → 1.2. */
function nextLabel(t: TestOverview): string {
  const newest = t.versions[0]?.version_label ?? '1.0';
  const parts = newest.split('.').map(Number);
  parts[parts.length - 1] += 1;
  return parts.join('.');
}

export default async function QuestionBankPage() {
  const staff = await requireStaff();
  const { profile } = staff;
  const rights = contentRights(profile);
  const overview = await loadOverview();

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Question bank"
        description="Every question, report text and rule of each assessment, as versioned data. Published versions never change."
        actions={
          rights.canEdit && overview.ready ? (
            <ButtonLink href="/question-bank/import" variant="primary">
              <FileUp size={18} strokeWidth={2} aria-hidden />
              <span>Import Excel</span>
            </ButtonLink>
          ) : undefined
        }
      />

      {!overview.ready && (
        <Notice variant="info" icon={<Database size={18} strokeWidth={2} />} title="The question bank is not set up yet">
          Run the migration <span className="font-mono text-[13px]">20261016000000_question_bank.sql</span> in the
          Supabase SQL Editor, then load the banks (see docs/tasks/03-load-banks.md).
        </Notice>
      )}

      {overview.ready && !rights.canEdit && (
        <Notice variant="info" icon={<Lock size={18} strokeWidth={2} />} className="mb-6">
          You can view the question bank. Changes are made by team members with editing rights.
        </Notice>
      )}

      {overview.ready && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {overview.tests.map((t) => (
            <Card key={t.test.code} className="flex flex-col p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Pill tone="quiet">{t.test.report_id_prefix}</Pill>
                  <h2 className="mt-2 text-[22px] font-semibold leading-[1.3] text-teal">{t.test.name_en}</h2>
                  {t.test.name_hi ? (
                    <p lang="hi" className="mt-0.5 text-[15px] text-ink-soft">{t.test.name_hi}</p>
                  ) : (
                    <p className="mt-0.5 text-[13px] text-ink-muted">Hindi name not set yet</p>
                  )}
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">Live</dt>
                  <dd className="mt-1 text-[15px] text-ink">
                    {t.live ? (
                      <Link href={`/question-bank/${t.live.id}`} className="font-semibold text-teal hover:underline">
                        v{t.live.version_label}
                      </Link>
                    ) : (
                      'None yet'
                    )}
                    {t.live && <span className="block text-[13px] text-ink-muted">{formatDateTime(t.live.published_at)}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">Draft / in review</dt>
                  <dd className="mt-1 text-[15px] text-ink">
                    {t.open ? (
                      <Link href={`/question-bank/${t.open.id}`} className="inline-flex items-center gap-2 font-semibold text-teal hover:underline">
                        v{t.open.version_label} <StatusPill status={t.open.status} />
                      </Link>
                    ) : (
                      'None'
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">Last change</dt>
                  <dd className="mt-1 text-[15px] text-ink">
                    {t.lastChange ? (
                      <>
                        {t.lastChange.by ?? 'System import'}
                        <span className="block text-[13px] text-ink-muted">
                          {formatDateTime(t.lastChange.at)} · {t.lastChange.what}
                        </span>
                      </>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>

              {t.versions.length > 0 && (
                <ul className="mt-5 divide-y divide-sand border-t border-sand">
                  {t.versions.map((v) => (
                    <li key={v.id}>
                      <Link
                        href={`/question-bank/${v.id}`}
                        className="flex min-h-[48px] items-center gap-3 py-2 transition-colors hover:bg-mist/50"
                      >
                        <span className="w-16 shrink-0 font-semibold text-ink">v{v.version_label}</span>
                        <StatusPill status={v.status} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
                          {v.change_note ?? v.source_file_name ?? ''}
                        </span>
                        <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {rights.canEdit && (
                <div className="mt-5 flex flex-wrap items-start gap-3">
                  {t.versions.length > 0 && !t.open ? (
                    <StartVersionForm testCode={t.test.code} suggestedLabel={nextLabel(t)} />
                  ) : (
                    <p className="text-[13px] text-ink-muted">
                      {t.open
                        ? 'Finish the open version before starting another.'
                        : 'Import the workbook to create the first version.'}
                    </p>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

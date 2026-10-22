import Link from 'next/link';
import { ChevronRight, Database } from 'lucide-react';
import { AI_PROMPT } from '@mfb/questionnaire';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { Card, Notice, Pill } from '../../components/brand';
import { canEditQuestionnaires, formatDateTime, listQuestionnaires } from '../../lib/services/questionnaires';
import { CopyButton } from './CopyButton';
import { NewQuestionnaireForm } from './NewQuestionnaireForm';
import { StatusPill } from './StatusPill';

export const dynamic = 'force-dynamic';

export default async function QuestionnairesPage() {
  const { profile } = await requireStaff();
  const canEdit = canEditQuestionnaires(profile.role);
  const list = await listQuestionnaires();

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Questionnaires"
        description="Copy the AI prompt, paste it into any AI with your questions, then import the JSON it returns. Read the questionnaire here and publish it."
        actions={canEdit ? <CopyButton text={AI_PROMPT} label="Copy AI prompt" variant="primary" /> : undefined}
      />

      {list.length === 0 && (
        <Notice variant="info" icon={<Database size={18} strokeWidth={2} />} title="No questionnaires yet">
          Run <span className="font-mono text-[13px]">20261026000001_questionnaires.sql</span> in the Supabase SQL Editor, or add one below.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {list.map(({ questionnaire: q, versions }) => {
          const live = versions.find((v) => v.status === 'live');
          const draft = versions.find((v) => v.status === 'draft');
          return (
            <Card key={q.code} className="flex flex-col p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="quiet">{q.code}</Pill>
                    <Pill tone="quiet">{q.report_prefix}-YYYY-NNNNN</Pill>
                  </div>
                  <h2 className="mt-2 text-[22px] font-semibold leading-[1.3] text-teal">
                    <Link href={`/questionnaires/${q.code}`} className="hover:underline">
                      {q.name_en}
                    </Link>
                  </h2>
                  {q.name_hi ? (
                    <p lang="hi" className="mt-0.5 text-[15px] text-ink-soft">
                      {q.name_hi}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[13px] text-ink-muted">Hindi name not set</p>
                  )}
                </div>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">Live</dt>
                  <dd className="mt-1 text-[15px] text-ink">
                    {live ? (
                      <Link href={`/questionnaires/${q.code}?v=${live.id}`} className="font-semibold text-teal hover:underline">
                        Version {live.number}
                      </Link>
                    ) : (
                      'None yet'
                    )}
                    {live && <span className="block text-[13px] text-ink-muted">{formatDateTime(live.published_at)}</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-muted">Draft</dt>
                  <dd className="mt-1 text-[15px] text-ink">
                    {draft ? (
                      <Link href={`/questionnaires/${q.code}?v=${draft.id}`} className="font-semibold text-teal hover:underline">
                        Version {draft.number}
                      </Link>
                    ) : (
                      'None'
                    )}
                    {draft && <span className="block text-[13px] text-ink-muted">{formatDateTime(draft.created_at)}</span>}
                  </dd>
                </div>
              </dl>

              {versions.length > 0 && (
                <ul className="mt-5 divide-y divide-sand border-t border-sand">
                  {versions.map((v) => (
                    <li key={v.id}>
                      <Link href={`/questionnaires/${q.code}?v=${v.id}`} className="flex min-h-12 items-center gap-3 py-2 transition-colors hover:bg-mist/50">
                        <span className="w-24 shrink-0 font-semibold text-ink">Version {v.number}</span>
                        <StatusPill status={v.status} />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">
                          {v.status === 'draft' ? `created ${formatDateTime(v.created_at)}` : `published ${formatDateTime(v.published_at)}${v.published_by_name ? ` by ${v.published_by_name}` : ''}`}
                        </span>
                        <ChevronRight size={16} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-5">
                <Link href={`/questionnaires/${q.code}`} className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-teal hover:underline">
                  Open {draft ? 'the draft' : live ? 'the live version' : 'and import the first version'}
                  <ChevronRight size={16} strokeWidth={2} aria-hidden />
                </Link>
              </div>
            </Card>
          );
        })}
        {canEdit && <NewQuestionnaireForm />}
      </div>
    </AdminShell>
  );
}

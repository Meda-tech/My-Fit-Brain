import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Rocket } from 'lucide-react';
import { AI_PROMPT, parseDefinition } from '@mfb/questionnaire';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Notice, Pill, cn } from '../../../components/brand';
import { canEditQuestionnaires, formatDateTime, getQuestionnaire, getVersion } from '../../../lib/services/questionnaires';
import { publishAction } from '../actions';
import { CopyButton } from '../CopyButton';
import { StatusPill } from '../StatusPill';
import { OverviewView, ReportView } from './QuestionnaireView';
import { ClientDetailsEditor } from './ClientDetailsEditor';
import { VersionBar } from './VersionBar';

export const dynamic = 'force-dynamic';

// Two areas: the versions (questions, rules, report: fixed once published) and the client details (one
// list for the questionnaire, edited at any time). A version is read in two tabs: overview and report.

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'report', label: 'Report' },
] as const;
type View = (typeof VIEWS)[number]['id'] | 'details';

const tabClasses = (active: boolean) =>
  cn(
    'inline-flex min-h-11 shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[15px] font-medium transition-colors',
    active ? 'border-teal font-semibold text-teal' : 'border-transparent text-ink-soft hover:text-teal'
  );

export default async function QuestionnairePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ v?: string; view?: string; imported?: string; published?: string }>;
}) {
  const { profile } = await requireStaff();
  const { code } = await params;
  const { v, view: viewParam, imported, published } = await searchParams;
  const found = await getQuestionnaire(code);
  if (!found) notFound();
  const { questionnaire: q, versions } = found;
  const canEdit = canEditQuestionnaires(profile.role);
  const view: View = viewParam === 'details' || VIEWS.some((x) => x.id === viewParam) ? (viewParam as View) : 'overview';

  const draft = versions.find((x) => x.status === 'draft');
  const live = versions.find((x) => x.status === 'live');
  const shownId = v ?? draft?.id ?? live?.id ?? versions[0]?.id ?? null;
  const shown = shownId ? await getVersion(shownId) : null;
  const parsed = shown ? parseDefinition(shown.definition) : null;
  // Copy JSON carries the current client-details list, so an edited JSON round-trips without losing it.
  const copy =
    shown && typeof shown.definition === 'object' && shown.definition !== null && !Array.isArray(shown.definition)
      ? { ...shown.definition, client_details: q.client_details }
      : shown?.definition;
  const json = shown ? JSON.stringify(copy, null, 2) : '';
  const jsonDetails = shown?.status === 'draft' && parsed?.ok ? parsed.definition.client_details : null;

  const href = (p: { v?: string | null; view?: View }) => {
    const sp = new URLSearchParams();
    if (p.v) sp.set('v', p.v);
    if (p.view && p.view !== 'overview') sp.set('view', p.view);
    const s = sp.toString();
    return `/questionnaires/${q.code}${s ? `?${s}` : ''}`;
  };
  const versionView: View = view === 'details' ? 'overview' : view;

  const draftDetailsNotice = jsonDetails && (
    <Notice variant="info">
      The draft&apos;s JSON has {jsonDetails.length} client-details question{jsonDetails.length === 1 ? '' : 's'}. Publishing it replaces the client-details
      list with them.
    </Notice>
  );

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        back={{ href: '/questionnaires', label: 'Back to questionnaires' }}
        eyebrow={<Pill tone="quiet">{q.code}</Pill>}
        title={q.name_en}
        description={live ? `Live: version ${live.number}, published ${formatDateTime(live.published_at)}` : 'No live version yet.'}
      />

      {imported && (
        <Notice variant="info" icon={<CheckCircle2 size={18} strokeWidth={2} />} className="mb-6">
          {imported === 'replaced' ? 'The draft was replaced with the new JSON.' : 'The draft was created.'} Read it through the tabs, then publish when it
          looks right.
        </Notice>
      )}
      {published && (
        <Notice variant="info" icon={<CheckCircle2 size={18} strokeWidth={2} />} className="mb-6">
          Published. New assessments use this version; running ones keep theirs.
        </Notice>
      )}

      {/* Area: versions, or the client details (not versioned) */}
      <nav aria-label="Questionnaire" className="mb-6 flex gap-2 overflow-x-auto border-b border-sand">
        <Link href={href({ v, view: versionView })} aria-current={view !== 'details' ? 'page' : undefined} className={tabClasses(view !== 'details')}>
          Versions
          <span className="text-[13px] font-normal text-ink-muted">questions and report</span>
        </Link>
        <Link href={href({ v, view: 'details' })} aria-current={view === 'details' ? 'page' : undefined} className={tabClasses(view === 'details')}>
          Client details
          <span className="text-[13px] font-normal text-ink-muted">same for every version</span>
        </Link>
      </nav>

      {view === 'details' ? (
        <div className="space-y-4">
          {draftDetailsNotice}
          <ClientDetailsEditor key={JSON.stringify(q.client_details)} code={q.code} details={q.client_details} canEdit={canEdit} />
        </div>
      ) : (
        <>
          <VersionBar
            key={`${shown?.id ?? 'none'}-${imported ?? ''}`}
            code={q.code}
            canEdit={canEdit}
            hasDraft={!!draft}
            prompt={AI_PROMPT}
            versions={versions.map((x) => ({
              id: x.id,
              number: x.number,
              status: x.status,
              href: href({ v: x.id, view: versionView }),
              active: x.id === shown?.id,
            }))}
          >
            {!shown && <p className="text-[15px] text-ink-muted">No version yet. Use New version to import the first one.</p>}

            {shown && (
              <>
                {/* The open version: what it is, and what can be done with it */}
                <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex flex-wrap items-center gap-2 text-[15px] text-ink-soft">
                    <span className="font-semibold text-ink">Version {shown.number}</span>
                    <StatusPill status={shown.status} />
                    <span>
                      {shown.status === 'draft' ? `created ${formatDateTime(shown.created_at)}` : `published ${formatDateTime(shown.published_at)}`}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <CopyButton text={json} label="Copy JSON" />
                    {canEdit && shown.status === 'draft' && parsed?.ok && (
                      <form action={publishAction}>
                        <input type="hidden" name="code" value={q.code} />
                        <input type="hidden" name="versionId" value={shown.id} />
                        <Button type="submit" variant="primary">
                          <Rocket size={18} strokeWidth={2} aria-hidden />
                          <span>Publish</span>
                        </Button>
                      </form>
                    )}
                  </div>
                </div>

                {parsed && !parsed.ok ? (
                  <Notice variant="error" title="This version cannot be read">
                    <ul className="mt-1 list-disc pl-5 text-[14px]">
                      {parsed.errors.map((e, i) => (
                        <li key={i}>
                          <span className="font-semibold">{e.where}:</span> {e.message}
                        </li>
                      ))}
                    </ul>
                  </Notice>
                ) : (
                  parsed && (
                    <>
                      <nav aria-label="Parts of this version" className="mb-6 flex gap-1 overflow-x-auto border-b border-sand">
                        {VIEWS.map((x) => (
                          <Link
                            key={x.id}
                            href={href({ v: shown.id, view: x.id })}
                            aria-current={versionView === x.id ? 'page' : undefined}
                            className={tabClasses(versionView === x.id)}
                          >
                            {x.label}
                            {x.id === 'overview' && parsed.warnings.length > 0 && (
                              <span className="rounded-full bg-mist px-2 text-[12px] font-semibold text-teal">{parsed.warnings.length} to check</span>
                            )}
                          </Link>
                        ))}
                      </nav>

                      {versionView === 'overview' && (
                        <div className="space-y-6">
                          {draftDetailsNotice}
                          <OverviewView definition={parsed.definition} warnings={parsed.warnings} />
                        </div>
                      )}
                      {versionView === 'report' && <ReportView definition={parsed.definition} />}
                    </>
                  )
                )}
              </>
            )}
          </VersionBar>
        </>
      )}
    </AdminShell>
  );
}

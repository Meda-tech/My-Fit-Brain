import Link from 'next/link';
import { ChevronRight, Search, SearchX, ShieldAlert } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { AttemptStatusPill, formatDateTime } from '../../components/attempts/AttemptStatusPill';
import { formatDisplayPhone } from '../../lib/phone';
import {
  ATTEMPTS_PAGE_SIZE,
  ATTEMPT_LISTS,
  ATTEMPT_LIST_LABELS,
  attemptListCounts,
  canViewReports,
  listAttempts,
  listQuestionnaireNames,
  type AttemptFilters,
  type AttemptList,
  type AttemptOverviewRow,
} from '../../lib/services/attempts';
import { Button, ButtonLink, Card, Pill, cn, inputClasses } from '../../components/brand';

export const dynamic = 'force-dynamic';

const ALERT_LABELS: Record<AttemptOverviewRow['alerts'][number], string> = {
  crisis: 'Crisis alert',
  home_safety: 'Home safety',
};

function Alerts({ alerts }: { alerts: AttemptOverviewRow['alerts'] }) {
  if (alerts.length === 0) return null;
  return (
    <>
      {alerts.map((kind) => (
        <Pill key={kind} tone="quiet" className="text-coral-deep">
          <ShieldAlert size={12} strokeWidth={2} aria-hidden />
          {ALERT_LABELS[kind]}
        </Pill>
      ))}
    </>
  );
}

function ConclusionPill({ row }: { row: AttemptOverviewRow }) {
  if (row.status !== 'completed') return <span className="text-ink-muted">—</span>;
  return row.conclusion_updated_at ? <Pill tone="mist">Written</Pill> : <Pill tone="quiet">Not yet</Pill>;
}

// Every assessment with its client, newest first. All staff see the list; opening one shows what their
// role allows. The conclusion column and "Needs conclusion" are for counsellors and super admins.
export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; test?: string; q?: string; page?: string }>;
}) {
  const { profile } = await requireStaff();
  const withReport = canViewReports(profile.role);
  const lists = ATTEMPT_LISTS.filter((l) => withReport || l !== 'needs_conclusion');

  const sp = await searchParams;
  const questionnaires = await listQuestionnaireNames();
  const filters: AttemptFilters = {
    list: (lists as readonly string[]).includes(sp.list ?? '') ? (sp.list as AttemptList) : 'all',
    test: questionnaires.some((t) => t.code === sp.test) ? (sp.test as string) : 'all',
    q: (sp.q ?? '').slice(0, 80),
    page: Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1),
  };
  const [{ rows, total }, counts] = await Promise.all([listAttempts(filters), attemptListCounts()]);
  const pages = Math.max(1, Math.ceil(total / ATTEMPTS_PAGE_SIZE));

  const href = (patch: Partial<Record<'list' | 'test' | 'q' | 'page', string>>) => {
    const next = { list: filters.list, test: filters.test, q: filters.q, page: String(filters.page), ...patch };
    const params = new URLSearchParams();
    if (next.list && next.list !== 'all') params.set('list', next.list);
    if (next.test && next.test !== 'all') params.set('test', next.test);
    if (next.q) params.set('q', next.q);
    if (next.page && next.page !== '1') params.set('page', next.page);
    const qs = params.toString();
    return `/assessments${qs ? `?${qs}` : ''}`;
  };

  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-11 items-center rounded-full border px-4 text-[14px] font-medium transition-colors',
      active ? 'border-teal bg-mist font-semibold text-teal' : 'border-sand bg-white text-ink-soft hover:border-teal hover:text-teal'
    );

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Assessments"
        description={
          withReport
            ? 'Every assessment with its client, newest first. Open one to see the answers, download the PDF and write your conclusion.'
            : 'Every assessment with its client, newest first. Answers and results are for counsellors and super admins.'
        }
      />

      {/* Filters: one GET form for search and test; status chips are links. */}
      <Card className="mb-6 p-4">
        <form method="GET" action="/assessments" className="space-y-4">
          {filters.list !== 'all' && <input type="hidden" name="list" value={filters.list} />}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search size={18} strokeWidth={2} aria-hidden className="pointer-events-none absolute left-3.5 top-3.75 text-teal" />
              <input
                type="search"
                name="q"
                aria-label="Search assessments"
                defaultValue={filters.q}
                placeholder="Client name, mobile number, email or report ID"
                className={`${inputClasses} pl-10`}
              />
            </div>
            {questionnaires.length > 1 && (
              <select name="test" aria-label="Assessment" defaultValue={filters.test} className={`${inputClasses} sm:w-56`}>
                <option value="all">All assessments</option>
                {questionnaires.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="secondary" className="flex-1 sm:flex-none">
                Search
              </Button>
              {(filters.q || filters.list !== 'all' || filters.test !== 'all') && (
                <ButtonLink href="/assessments" variant="ghost">
                  Clear
                </ButtonLink>
              )}
            </div>
          </div>

          <nav aria-label="Status" className="flex flex-wrap gap-2">
            {lists.map((l) => (
              <Link key={l} href={href({ list: l, page: '1' })} aria-current={filters.list === l ? 'page' : undefined} className={chip(filters.list === l)}>
                {ATTEMPT_LIST_LABELS[l]}
                {counts[l] !== undefined && <span className="ml-1.5 text-[13px] font-normal text-ink-muted">{counts[l]}</span>}
              </Link>
            ))}
          </nav>
        </form>
      </Card>

      <Card className="@container overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand p-4 sm:p-5">
          <p className="text-[16px] font-semibold text-teal">
            {total} {total === 1 ? 'assessment' : 'assessments'}
          </p>
          {filters.q && <span className="text-[14px] text-ink-muted">Results for &ldquo;{filters.q}&rdquo;</span>}
        </div>

        {rows.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <SearchX size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No assessments match.</p>
            <p className="mt-1 text-[14px] text-ink-muted">An assessment appears here once the client presses Start after paying.</p>
          </div>
        ) : (
          <>
            {/* Mobile: stacked list */}
            <ul className="divide-y divide-sand @3xl:hidden">
              {rows.map((a) => (
                <li key={a.id}>
                  <Link href={`/attempts/${a.id}`} className="flex items-center gap-3 p-4 transition-colors hover:bg-mist/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-ink">{a.client_name ?? 'Client'}</p>
                      <p className="mt-0.5 text-[14px] text-ink-soft">
                        {a.questionnaire_name} · <span className="font-mono text-[13px]">{a.report_id}</span>
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-muted">
                        {a.completed_at ? `Completed ${formatDateTime(a.completed_at)}` : a.started_at ? `Started ${formatDateTime(a.started_at)}` : `Paid ${formatDateTime(a.paid_at)}`}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <AttemptStatusPill status={a.status} />
                        <Alerts alerts={a.alerts} />
                        {withReport && a.status === 'completed' && (a.conclusion_updated_at ? <Pill tone="mist">Conclusion written</Pill> : <Pill tone="quiet">No conclusion yet</Pill>)}
                      </div>
                    </div>
                    <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto @3xl:block">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-sand bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Client</th>
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Assessment</th>
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Status</th>
                    <th className="hidden whitespace-nowrap px-5 py-3 font-semibold @[60rem]:table-cell">Started</th>
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Completed</th>
                    {withReport && <th className="whitespace-nowrap px-5 py-3 font-semibold">Conclusion</th>}
                    <th className="whitespace-nowrap px-5 py-3 text-right font-semibold">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {rows.map((a) => (
                    <tr key={a.id} className="transition-colors hover:bg-mist/50">
                      <td className="px-5 py-3.5">
                        <Link href={`/clients/${a.client_id}`} className="font-semibold text-ink hover:text-teal">
                          {a.client_name ?? 'Client'}
                        </Link>
                        {a.client_phone && <span className="block font-mono text-[13px] text-ink-soft">{formatDisplayPhone(a.client_phone)}</span>}
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="block text-ink">{a.questionnaire_name}</span>
                        <span className="block font-mono text-[13px] text-ink-muted">{a.report_id}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-1.5">
                          <AttemptStatusPill status={a.status} />
                          <Alerts alerts={a.alerts} />
                        </div>
                      </td>
                      <td className="hidden whitespace-nowrap px-5 py-3.5 text-ink-muted @[60rem]:table-cell">{formatDateTime(a.started_at)}</td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-ink-muted">{formatDateTime(a.completed_at)}</td>
                      {withReport && (
                        <td className="px-5 py-3.5">
                          <ConclusionPill row={a} />
                        </td>
                      )}
                      <td className="px-5 py-3.5 text-right">
                        <ButtonLink href={`/attempts/${a.id}`} variant="secondary" size="sm">
                          <span>Open</span>
                          <ChevronRight size={16} strokeWidth={2} aria-hidden />
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {pages > 1 && (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-sand p-4 text-[14px]">
            {filters.page > 1 ? (
              <ButtonLink href={href({ page: String(filters.page - 1) })} variant="ghost" size="sm">
                Previous
              </ButtonLink>
            ) : (
              <span />
            )}
            <span className="text-ink-muted">
              Page {filters.page} of {pages}
            </span>
            {filters.page < pages ? (
              <ButtonLink href={href({ page: String(filters.page + 1) })} variant="ghost" size="sm">
                Next
              </ButtonLink>
            ) : (
              <span />
            )}
          </nav>
        )}
      </Card>
    </AdminShell>
  );
}

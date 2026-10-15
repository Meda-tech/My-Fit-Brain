import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertCircle, Lock } from 'lucide-react';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { Notice, cn } from '../../../components/brand';
import {
  contentRights,
  formatDateTime,
  loadHistory,
  loadTestCases,
  loadValidation,
  loadVersion,
  loadVersionConfig,
} from '../../../lib/question-bank/data';
import { StatusPill } from '../StatusPill';
import { ItemTextsTab, PlansTab, QuestionsTab, TextsTab } from './content-tabs';
import { RulesTab } from './rules-tab';
import { HistoryTab, TestCasesTab, ValidationTab } from './status-tabs';
import { VersionActions } from './VersionActions';

export const dynamic = 'force-dynamic';

const TABS = [
  { id: 'questions', label: 'Questions' },
  { id: 'texts', label: 'Report texts' },
  { id: 'items', label: 'Strengths & stuck' },
  { id: 'plans', label: 'Plans & bands' },
  { id: 'rules', label: 'Rules' },
  { id: 'tests', label: 'Test cases' },
  { id: 'validation', label: 'Validation' },
  { id: 'history', label: 'History' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function VersionPage({ params, searchParams }: PageProps) {
  const staff = await requireStaff();
  const { profile } = staff;
  const rights = contentRights(profile);
  const { versionId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: TabId = TABS.some((t) => t.id === rawTab) ? (rawTab as TabId) : 'questions';
  if (!UUID.test(versionId)) notFound();

  const version = await loadVersion(versionId);
  if (!version) notFound();

  const [config, issues] = await Promise.all([
    loadVersionConfig(versionId).catch((err: Error) => err),
    loadValidation(versionId),
  ]);
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const frozen = version.status === 'live' || version.status === 'retired';

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        back={{ href: '/question-bank', label: 'Back to question bank' }}
        eyebrow={<StatusPill status={version.status} />}
        title={`${config instanceof Error ? version.test_code : config.test.name_en} v${version.version_label}`}
        description={
          <span className="block space-y-0.5 text-[14px]">
            <span className="block">
              Created {formatDateTime(version.created_at)}
              {version.creator ? ` by ${version.creator}` : ''}
              {version.source_file_name ? ` from ${version.source_file_name}` : ''}.
            </span>
            {version.submitted_at && (
              <span className="block">Submitted {formatDateTime(version.submitted_at)}{version.submitter ? ` by ${version.submitter}` : ''}.</span>
            )}
            {version.published_at && (
              <span className="block">Published {formatDateTime(version.published_at)}{version.approver ? ` by ${version.approver}` : ''}.</span>
            )}
            {version.retired_at && <span className="block">Retired {formatDateTime(version.retired_at)}.</span>}
            {version.change_note && <span className="block">Note: {version.change_note}</span>}
          </span>
        }
      />

      {frozen && (
        <Notice variant="info" className="mb-6" icon={<Lock size={18} strokeWidth={2} />}>
          This version is {version.status} and can never change. To make changes, start a new version.
        </Notice>
      )}

      <VersionActions
        versionId={version.id}
        status={version.status}
        canEdit={rights.canEdit}
        canApprove={rights.canApprove}
        errorCount={errorCount}
      />

      <nav aria-label="Version sections" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-sand">
          {TABS.map((t) => (
            <li key={t.id}>
              <Link
                href={`/question-bank/${version.id}?tab=${t.id}`}
                aria-current={tab === t.id ? 'page' : undefined}
                className={cn(
                  'inline-flex min-h-[44px] items-center border-b-2 px-3 text-[14px] font-medium transition-colors',
                  tab === t.id ? 'border-teal font-semibold text-teal' : 'border-transparent text-ink-soft hover:text-teal'
                )}
              >
                {t.label}
                {t.id === 'validation' && errorCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-coral-deep px-1.5 text-[11px] font-semibold leading-[18px] text-white">
                    {errorCount}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {config instanceof Error && tab !== 'validation' && tab !== 'history' ? (
        <Notice variant="error" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
          This version could not be loaded: {config.message}
        </Notice>
      ) : (
        <TabContent tab={tab} versionId={version.id} config={config} issues={issues} />
      )}
    </AdminShell>
  );
}

async function TabContent({
  tab,
  versionId,
  config,
  issues,
}: {
  tab: TabId;
  versionId: string;
  config: Awaited<ReturnType<typeof loadVersionConfig>> | Error;
  issues: Awaited<ReturnType<typeof loadValidation>>;
}) {
  if (tab === 'validation') return <ValidationTab issues={issues} />;
  if (tab === 'history') {
    const history = await loadHistory(versionId);
    return <HistoryTab rows={history.rows} total={history.total} />;
  }
  if (tab === 'tests') return <TestCasesTab cases={await loadTestCases(versionId)} />;
  if (config instanceof Error) return null;
  if (tab === 'texts') return <TextsTab config={config} />;
  if (tab === 'items') return <ItemTextsTab config={config} />;
  if (tab === 'plans') return <PlansTab config={config} />;
  if (tab === 'rules') return <RulesTab config={config} />;
  return <QuestionsTab config={config} />;
}

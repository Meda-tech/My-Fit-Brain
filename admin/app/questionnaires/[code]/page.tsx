import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Rocket } from 'lucide-react';
import { AI_PROMPT, parseDefinition } from '@mfb/questionnaire';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Notice, Pill, cn } from '../../../components/brand';
import { canEditQuestionnaires, formatDateTime, getQuestionnaire, getVersion } from '../../../lib/services/questionnaires';
import { publishAction } from '../actions';
import { CopyButton } from '../CopyButton';
import { ImportJsonForm } from '../ImportJsonForm';
import { StatusPill } from '../StatusPill';
import { QuestionnaireView } from './QuestionnaireView';

export const dynamic = 'force-dynamic';

export default async function QuestionnairePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ v?: string; imported?: string; published?: string }>;
}) {
  const { profile } = await requireStaff();
  const { code } = await params;
  const { v, imported, published } = await searchParams;
  const found = await getQuestionnaire(code);
  if (!found) notFound();
  const { questionnaire: q, versions } = found;
  const canEdit = canEditQuestionnaires(profile.role);

  const draft = versions.find((x) => x.status === 'draft');
  const live = versions.find((x) => x.status === 'live');
  const shownId = v ?? draft?.id ?? live?.id ?? versions[0]?.id ?? null;
  const shown = shownId ? await getVersion(shownId) : null;
  const parsed = shown ? parseDefinition(shown.definition) : null;
  const json = shown ? JSON.stringify(shown.definition, null, 2) : '';

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        back={{ href: '/questionnaires', label: 'Back to questionnaires' }}
        eyebrow={
          <>
            <Pill tone="quiet">{q.code}</Pill>
            {shown && <StatusPill status={shown.status} />}
          </>
        }
        title={q.name_en}
        description={
          shown
            ? `Version ${shown.number} · ${shown.status === 'draft' ? `created ${formatDateTime(shown.created_at)}` : `published ${formatDateTime(shown.published_at)}`}`
            : 'No version yet. Copy the AI prompt, get the JSON, and import it below.'
        }
        actions={
          <>
            <CopyButton text={AI_PROMPT} label="Copy AI prompt" />
            {shown && <CopyButton text={json} label="Copy JSON" />}
            {canEdit && shown?.status === 'draft' && parsed?.ok && (
              <form action={publishAction}>
                <input type="hidden" name="code" value={q.code} />
                <input type="hidden" name="versionId" value={shown.id} />
                <Button type="submit" variant="primary">
                  <Rocket size={18} strokeWidth={2} aria-hidden />
                  <span>Publish</span>
                </Button>
              </form>
            )}
          </>
        }
      />

      {imported && (
        <Notice variant="info" icon={<CheckCircle2 size={18} strokeWidth={2} />} className="mb-6">
          {imported === 'replaced' ? 'The draft was replaced with the new JSON.' : 'The draft was created.'} Read it below, then publish when it looks right.
        </Notice>
      )}
      {published && (
        <Notice variant="info" icon={<CheckCircle2 size={18} strokeWidth={2} />} className="mb-6">
          Published. New assessments use this version; running ones keep theirs.
        </Notice>
      )}

      {versions.length > 1 && (
        <nav aria-label="Versions" className="mb-6 flex flex-wrap gap-2">
          {versions.map((x) => (
            <Link
              key={x.id}
              href={`/questionnaires/${q.code}?v=${x.id}`}
              className={cn(
                'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors',
                x.id === shown?.id ? 'border-teal bg-mist text-teal' : 'border-sand bg-white text-ink-soft hover:border-teal'
              )}
            >
              Version {x.number} <span className="text-ink-muted">· {x.status}</span>
            </Link>
          ))}
        </nav>
      )}

      {canEdit && (
        <Card className="mb-6 p-5 sm:p-6">
          <ImportJsonForm code={q.code} hasDraft={!!draft} />
        </Card>
      )}

      {shown && parsed && (parsed.ok ? <QuestionnaireView definition={parsed.definition} warnings={parsed.warnings} /> : (
        <Notice variant="error" title="This version cannot be read">
          <ul className="mt-1 list-disc pl-5 text-[14px]">
            {parsed.errors.map((e, i) => (
              <li key={i}>
                <span className="font-semibold">{e.where}:</span> {e.message}
              </li>
            ))}
          </ul>
        </Notice>
      ))}
    </AdminShell>
  );
}

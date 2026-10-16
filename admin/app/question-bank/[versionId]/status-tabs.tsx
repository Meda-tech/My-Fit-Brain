import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ValidationIssue } from '@mfb/questionbank';
import { Card, Notice, Pill } from '../../../components/brand';
import { describeChange, formatDateTime, type AuditRow, type TestCaseRow, type TestRunRow } from '../../../lib/question-bank/data';
import { RunTestCasesButton } from './RunTestCasesButton';
import { JsonDetails, Section } from './parts';

// Test cases, Validation and History tabs.

export function TestCasesTab({
  cases,
  runs,
  versionId,
  canRun,
  engineVersion,
}: {
  cases: TestCaseRow[];
  runs: Map<string, TestRunRow> | null;
  versionId: string;
  canRun: boolean;
  engineVersion: string;
}) {
  const status = (tc: TestCaseRow) => {
    const r = runs?.get(tc.id);
    if (!r) return { label: 'Not run', tone: 'quiet' as const };
    if (!r.passed) return { label: 'Failed', tone: 'quiet' as const };
    if (!r.current) return { label: 'Passed (out of date)', tone: 'quiet' as const };
    return { label: 'Passed', tone: 'mist' as const };
  };
  return (
    <Section title="Test cases" count={cases.length}>
      <p className="-mt-1 mb-3 text-[13px] text-ink-muted">
        Each case is scored by the engine and compared with its expected result. Publishing needs every case passing
        on the current engine version, run after the last change to this version.
      </p>
      {runs === null && (
        <Notice variant="info" className="mb-4" icon={<Info size={18} strokeWidth={2} />}>
          Test runs are not set up yet. Run the Task 04 migration (docs/tasks/04-apply.sql) in the Supabase SQL Editor.
        </Notice>
      )}
      {canRun && runs !== null && <RunTestCasesButton versionId={versionId} engineVersion={engineVersion} />}
      <div className="space-y-3">
        {cases.map((tc) => {
          const expected = tc.expected as { bands?: Record<string, string>; tier?: number; format?: string; primary?: string; flags?: string[]; layout?: string };
          const run = runs?.get(tc.id);
          const st = status(tc);
          return (
            <Card key={tc.id} shadow={false} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-semibold text-ink">{tc.name}</span>
                <Pill tone="quiet">{tc.source.replace('_', ' ')}</Pill>
                <Pill tone={st.tone}>{st.label}</Pill>
                {run && (
                  <span className="text-[12px] text-ink-muted">
                    engine {run.engine_version} · {formatDateTime(run.run_at)}{run.runner ? ` · ${run.runner}` : ''}
                  </span>
                )}
              </div>
              <p className="text-[14px] text-ink-soft">
                Expected: {expected.tier} sessions · {expected.format?.replace(/_/g, ' ')} · primary {expected.primary} ·{' '}
                {Object.entries(expected.bands ?? {}).map(([m, b]) => `${m} ${b}`).join(', ')}
                {expected.flags?.length ? ` · flags ${expected.flags.join(', ')}` : ''}
                {expected.layout === 'crisis' ? ' · crisis layout' : ''}
              </p>
              {run?.error && <p className="mt-2 text-[14px] text-coral-deep">Error: {run.error}</p>}
              {run && run.diffs.length > 0 && (
                <table className="mt-2 w-full text-left text-[13px]">
                  <thead className="text-[11px] uppercase tracking-[0.06em] text-ink-muted">
                    <tr>
                      <th className="py-1 pr-2 font-semibold">Field</th>
                      <th className="py-1 pr-2 font-semibold">Expected</th>
                      <th className="py-1 font-semibold">Actual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sand font-mono">
                    {run.diffs.map((d) => (
                      <tr key={d.field}>
                        <td className="py-1 pr-2 text-ink">{d.field}</td>
                        <td className="break-all py-1 pr-2 text-ink-soft">{JSON.stringify(d.expected)}</td>
                        <td className="break-all py-1 text-coral-deep">{JSON.stringify(d.actual)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tc.notes && <p className="mt-1 text-[13px] text-ink-muted">{tc.notes}</p>}
              {run && run.trace.length > 0 && (
                <details className="mt-2 text-[13px]">
                  <summary className="inline-flex min-h-8 cursor-pointer items-center text-teal hover:underline">How the engine decided</summary>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-ink-soft">
                    {run.trace.map((t, i) => (
                      <li key={i}>
                        <span className="font-mono text-[12px] text-ink-muted">{t.step}</span> {t.detail}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              <JsonDetails value={{ context: tc.context, answers: tc.answers, expected: tc.expected }} label="Answers and expected result" />
            </Card>
          );
        })}
      </div>
    </Section>
  );
}

export function ValidationTab({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (issues.length === 0) {
    return (
      <Notice variant="info" icon={<CheckCircle2 size={18} strokeWidth={2} />} title="No validation issues">
        Every text has Hindi, every option set is valid, and every rule points to real questions, options, modules and texts.
      </Notice>
    );
  }
  return (
    <>
      {errors.length > 0 && (
        <Notice
          variant="error"
          className="mb-4"
          title={`${errors.length} error${errors.length === 1 ? '' : 's'} — the version cannot be submitted or published`}
          icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
        >
          <ul className="list-disc space-y-1 pl-5">
            {errors.map((e, i) => (
              <li key={i}>
                <span className="font-mono text-[12px] text-ink-muted">{e.code}</span> {e.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice variant="info" title="Warnings" icon={<Info size={18} strokeWidth={2} />}>
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </Notice>
      )}
    </>
  );
}

export function HistoryTab({ rows, total }: { rows: AuditRow[]; total: number }) {
  return (
    <Section title="History" count={total}>
      {total > rows.length && <p className="-mt-1 mb-3 text-[13px] text-ink-muted">Showing the latest {rows.length}.</p>}
      <Card shadow={false} className="overflow-x-auto">
        <table className="w-full text-left text-[14px]">
          <thead className="bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
            <tr>
              <th className="whitespace-nowrap px-4 py-2 font-semibold">When</th>
              <th className="whitespace-nowrap px-4 py-2 font-semibold">Who</th>
              <th className="whitespace-nowrap px-4 py-2 font-semibold">What</th>
              <th className="whitespace-nowrap px-4 py-2 font-semibold">Row</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-4 py-2 text-ink-muted">{formatDateTime(r.changed_at)}</td>
                <td className="whitespace-nowrap px-4 py-2 text-ink">{r.editor ?? 'System import'}</td>
                <td className="px-4 py-2 text-ink-soft">{describeChange(r.table_name, r.action)}</td>
                <td className="px-4 py-2 font-mono text-[12px] text-ink-muted">
                  {Object.values(r.row_key ?? {}).filter((v) => v !== null).join(' · ') || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </Section>
  );
}

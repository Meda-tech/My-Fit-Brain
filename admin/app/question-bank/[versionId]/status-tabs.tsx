import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ValidationIssue } from '@mfb/questionbank';
import { Card, Notice, Pill } from '../../../components/brand';
import { describeChange, formatDateTime, type AuditRow, type TestCaseRow } from '../../../lib/question-bank/data';
import { JsonDetails, Section } from './parts';

// Test cases, Validation and History tabs.

export function TestCasesTab({ cases }: { cases: TestCaseRow[] }) {
  return (
    <Section title="Test cases" count={cases.length}>
      <p className="-mt-1 mb-3 text-[13px] text-ink-muted">
        Worked examples from the workbook. The scoring engine checks each one and marks it verified.
      </p>
      <div className="space-y-3">
        {cases.map((tc) => {
          const expected = tc.expected as { bands?: Record<string, string>; tier?: number; format?: string; primary?: string; flags?: string[]; layout?: string };
          return (
            <Card key={tc.id} shadow={false} className="p-4">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-semibold text-ink">{tc.name}</span>
                <Pill tone="quiet">{tc.source.replace('_', ' ')}</Pill>
                <Pill tone={tc.verified ? 'mist' : 'quiet'}>{tc.verified ? 'Verified' : 'Not verified yet'}</Pill>
              </div>
              <p className="text-[14px] text-ink-soft">
                Expected: {expected.tier} sessions · {expected.format?.replace(/_/g, ' ')} · primary {expected.primary} ·{' '}
                {Object.entries(expected.bands ?? {}).map(([m, b]) => `${m} ${b}`).join(', ')}
                {expected.flags?.length ? ` · flags ${expected.flags.join(', ')}` : ''}
                {expected.layout === 'crisis' ? ' · crisis layout' : ''}
              </p>
              {tc.notes && <p className="mt-1 text-[13px] text-ink-muted">{tc.notes}</p>}
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

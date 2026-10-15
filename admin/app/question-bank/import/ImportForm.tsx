'use client';

import { useActionState, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Info } from 'lucide-react';
import { Button, Card, Notice, Pill, helpTextClasses, inputClasses, labelClasses } from '../../../components/brand';
import { checkImportAction, createDraftAction, type ImportCheckState, type QbActionState } from '../actions';

const MAX_BYTES = 5 * 1024 * 1024;

export function ImportForm() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [check, checkAction, checking] = useActionState<ImportCheckState | null, FormData>(checkImportAction, null);
  const [create, createAction, creating] = useActionState<QbActionState | null, FormData>(createDraftAction, null);

  const onFileChange = () => {
    const file = fileRef.current?.files?.[0];
    setLocalError(file && file.size > MAX_BYTES ? 'The file is larger than 5 MB.' : null);
  };

  const errors = check ? [...check.errors, ...check.issues.filter((i) => i.severity === 'error').map((i) => i.message)] : [];
  const warnings = check ? [...check.warnings, ...check.issues.filter((i) => i.severity === 'warning').map((i) => i.message)] : [];
  const canCreate = !!check?.ok && errors.length === 0 && !check.blockedBy;

  return (
    <form className="space-y-6">
      <Card className="p-5 sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-[20px] font-semibold text-teal">
          <FileSpreadsheet size={18} strokeWidth={2} aria-hidden />
          <span>Workbook</span>
        </h2>
        <label htmlFor="file" className={labelClasses}>
          Question bank file (.xlsx, up to 5 MB)
        </label>
        <input
          ref={fileRef}
          id="file"
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
          onChange={onFileChange}
          className={`${inputClasses} py-2.5 file:mr-3 file:rounded-full file:border-0 file:bg-mist file:px-4 file:py-2 file:font-semibold file:text-teal`}
        />
        <p className={helpTextClasses}>
          The test and version are read from the README title. Rules come from the matching seed file, or are copied from
          the latest version of that test.
        </p>

        <label htmlFor="changeNote" className={`${labelClasses} mt-4`}>
          Note for this draft (optional)
        </label>
        <input id="changeNote" name="changeNote" type="text" maxLength={300} className={inputClasses} />

        {localError && (
          <Notice variant="error" role="alert" className="mt-4" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
            {localError}
          </Notice>
        )}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" variant="secondary" formAction={checkAction} loading={checking} loadingText="Checking..." disabled={!!localError}>
            Check file
          </Button>
        </div>
      </Card>

      {check && (
        <Card className="p-5 sm:p-6">
          <h2 className="mb-4 text-[20px] font-semibold text-teal">Preview</h2>

          {check.preview && (
            <div className="mb-5 flex flex-wrap items-center gap-2 text-[15px] text-ink">
              <Pill>{check.preview.test_code}</Pill>
              <span className="font-semibold">Version {check.preview.version_label}</span>
              <span className="text-ink-muted">· {check.fileName}</span>
              {check.source && (
                <span className="text-ink-muted">
                  · Rules:{' '}
                  {check.source.kind === 'seed'
                    ? `seed file ${check.source.file}`
                    : `copied from version ${check.source.from_version_label}`}
                </span>
              )}
            </div>
          )}

          {check.preview && (
            <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-2">
              <CountTable title="Rows per tab" counts={check.preview.tab_counts} />
              <CountTable title="Rows to create" counts={check.preview.counts} />
            </div>
          )}

          {check.blockedBy && (
            <Notice variant="error" role="alert" className="mb-4" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
              {check.blockedBy}
            </Notice>
          )}

          {errors.length > 0 && (
            <Notice
              variant="error"
              role="alert"
              className="mb-4"
              title={`${errors.length} error${errors.length === 1 ? '' : 's'} — fix these in the workbook or rules first`}
              icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
            >
              <ul className="list-disc space-y-1 pl-5">
                {errors.slice(0, 50).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
              {errors.length > 50 && <p className="mt-2">…and {errors.length - 50} more.</p>}
            </Notice>
          )}

          {warnings.length > 0 && (
            <Notice variant="info" className="mb-4" title="Warnings" icon={<Info size={18} strokeWidth={2} />}>
              <ul className="list-disc space-y-1 pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}

          {canCreate && (
            <Notice variant="info" className="mb-4" icon={<CheckCircle2 size={18} strokeWidth={2} />}>
              No errors. Creating the draft runs the same checks again in the database.
            </Notice>
          )}

          {create?.error && (
            <Notice variant="error" role="alert" className="mb-4" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
              {create.error}
            </Notice>
          )}

          <Button type="submit" formAction={createAction} disabled={!canCreate} loading={creating} loadingText="Creating draft...">
            Create draft
          </Button>
        </Card>
      )}
    </form>
  );
}

function CountTable({ title, counts }: { title: string; counts: Record<string, number> }) {
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-muted">{title}</p>
      <table className="w-full text-left text-[14px]">
        <tbody className="divide-y divide-sand">
          {Object.entries(counts).map(([name, n]) => (
            <tr key={name}>
              <td className="py-1.5 pr-3 text-ink-soft">{name.replace(/_/g, ' ')}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-ink">{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

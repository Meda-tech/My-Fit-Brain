'use client';

import { useActionState } from 'react';
import { FileJson } from 'lucide-react';
import { Button, Notice, inputClasses, labelClasses } from '../../components/brand';
import { importJsonAction, type FormState } from './actions';

/** Paste the AI's JSON. Creates the draft, or replaces the open draft, then shows the readable page. */
export function ImportJsonForm({ code, hasDraft }: { code: string; hasDraft: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(importJsonAction, { error: null });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="code" value={code} />
      <label htmlFor="json" className={labelClasses}>
        Paste the questionnaire JSON
      </label>
      <textarea
        id="json"
        name="json"
        required
        rows={10}
        spellCheck={false}
        placeholder='{ "title": { "en": "…", "hi": "…" }, "sections": [ … ] }'
        className={`${inputClasses} min-h-40 font-mono text-[13px]`}
      />
      {state.error && (
        <Notice variant="error" role="alert">
          <p>{state.error}</p>
          {state.errors && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
              {state.errors.map((e, i) => (
                <li key={i}>
                  <span className="font-semibold">{e.where}:</span> {e.message}
                </li>
              ))}
            </ul>
          )}
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} loadingText="Importing...">
          <FileJson size={18} strokeWidth={2} aria-hidden />
          <span>{hasDraft ? 'Replace the draft' : 'Create draft'}</span>
        </Button>
        <p className="text-[13px] text-ink-muted">
          {hasDraft ? 'The open draft is replaced with this JSON.' : 'A new draft version is created. Published versions never change.'}
        </p>
      </div>
    </form>
  );
}

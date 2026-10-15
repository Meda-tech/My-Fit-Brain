'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, CopyPlus } from 'lucide-react';
import { Button, Notice, inputClasses, labelClasses } from '../../components/brand';
import { startNewVersionAction, type QbActionState } from './actions';

interface StartVersionFormProps {
  testCode: string;
  suggestedLabel: string;
}

export function StartVersionForm({ testCode, suggestedLabel }: StartVersionFormProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<QbActionState | null, FormData>(startNewVersionAction, null);

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <CopyPlus size={16} strokeWidth={2} aria-hidden />
        <span>Start new version</span>
      </Button>
    );
  }

  return (
    <form action={formAction} className="w-full space-y-3 rounded-input border border-sand bg-cream p-4">
      <input type="hidden" name="testCode" value={testCode} />
      <div>
        <label htmlFor={`label-${testCode}`} className={labelClasses}>
          New version number
        </label>
        <input
          id={`label-${testCode}`}
          name="versionLabel"
          required
          defaultValue={suggestedLabel}
          pattern="[0-9]+(\.[0-9]+)*"
          className={inputClasses}
        />
        <p className="mt-1.5 text-[13px] text-ink-muted">Copies the live version (or the latest one) into a new draft.</p>
      </div>
      {state?.error && (
        <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
          {state.error}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" size="sm" loading={isPending} loadingText="Copying...">
          Create draft
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

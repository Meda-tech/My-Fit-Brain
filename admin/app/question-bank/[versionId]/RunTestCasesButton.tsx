'use client';

import { useActionState } from 'react';
import { AlertCircle, CheckCircle2, Play } from 'lucide-react';
import { Button, Notice } from '../../../components/brand';
import { runTestCasesAction, type RunTestCasesState } from '../actions';

export function RunTestCasesButton({ versionId, engineVersion }: { versionId: string; engineVersion: string }) {
  const [state, formAction, isPending] = useActionState<RunTestCasesState | null, FormData>(runTestCasesAction, null);
  return (
    <form action={formAction} className="mb-4 space-y-3">
      <input type="hidden" name="versionId" value={versionId} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" loading={isPending} loadingText="Running...">
          <Play size={16} strokeWidth={2} aria-hidden />
          <span>Run all test cases</span>
        </Button>
        <span className="text-[13px] text-ink-muted">Engine {engineVersion}</span>
      </div>
      {state?.error && (
        <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
          {state.error}
        </Notice>
      )}
      {state?.ok && (
        <Notice variant={state.failed ? 'error' : 'info'} role="status" icon={<CheckCircle2 size={18} strokeWidth={2} />}>
          {state.passed} passed{state.failed ? `, ${state.failed} failed` : ''}. Results are recorded below.
        </Notice>
      )}
    </form>
  );
}

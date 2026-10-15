'use client';

import { useActionState, useState } from 'react';
import { AlertCircle, CheckCircle2, Send, Trash2, Undo2, Upload } from 'lucide-react';
import type { VersionStatus } from '@mfb/questionbank';
import { Button, Card, Notice, labelClasses, inputClasses } from '../../../components/brand';
import { versionStatusAction, type QbActionState } from '../actions';

interface VersionActionsProps {
  versionId: string;
  status: VersionStatus;
  canEdit: boolean;
  canApprove: boolean;
  errorCount: number;
  /** Why publishing is not possible yet (test runs missing, failing or out of date), or null. */
  publishBlocked: string | null;
}

export function VersionActions({ versionId, status, canEdit, canApprove, errorCount, publishBlocked }: VersionActionsProps) {
  const [state, formAction, isPending] = useActionState<QbActionState | null, FormData>(versionStatusAction, null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const canSubmit = status === 'draft' && canEdit;
  const canDelete = status === 'draft' && canEdit;
  const canReturn = status === 'in_review' && (canEdit || canApprove);
  const canPublish = status === 'in_review' && canApprove;
  if (!canSubmit && !canDelete && !canReturn && !canPublish) return null;

  return (
    <Card className="mb-6 p-4 sm:p-5">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="versionId" value={versionId} />

        {state?.error && (
          <Notice variant="error" role="alert" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
            <span className="whitespace-pre-line">{state.error}</span>
          </Notice>
        )}
        {state?.ok && (
          <Notice variant="info" role="status" icon={<CheckCircle2 size={18} strokeWidth={2} />}>
            Done.
          </Notice>
        )}

        {publishing && (
          <div>
            <label htmlFor="changeNote" className={labelClasses}>
              Change note (required, shown in the version history)
            </label>
            <textarea id="changeNote" name="changeNote" required rows={2} maxLength={500} className={`${inputClasses} py-3`} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {canSubmit && (
            <Button
              type="submit"
              name="action"
              value="submit"
              loading={isPending}
              disabled={errorCount > 0}
              title={errorCount > 0 ? 'Fix the validation errors first' : undefined}
            >
              <Send size={16} strokeWidth={2} aria-hidden />
              <span>Submit for review</span>
            </Button>
          )}
          {canPublish &&
            (publishing ? (
              <>
                <Button type="submit" name="action" value="publish" loading={isPending} loadingText="Publishing...">
                  <Upload size={16} strokeWidth={2} aria-hidden />
                  <span>Publish now</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPublishing(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button onClick={() => setPublishing(true)} disabled={errorCount > 0 || !!publishBlocked}>
                <Upload size={16} strokeWidth={2} aria-hidden />
                <span>Publish…</span>
              </Button>
            ))}
          {canReturn && !publishing && (
            <Button type="submit" name="action" value="return" variant="secondary" loading={isPending}>
              <Undo2 size={16} strokeWidth={2} aria-hidden />
              <span>Return to draft</span>
            </Button>
          )}
          {canDelete &&
            (confirmDelete ? (
              <>
                <Button type="submit" name="action" value="delete" variant="secondary" loading={isPending}>
                  <Trash2 size={16} strokeWidth={2} aria-hidden />
                  <span>Yes, delete this draft</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 size={16} strokeWidth={2} aria-hidden />
                <span>Delete draft</span>
              </Button>
            ))}
        </div>
        {status === 'in_review' && canPublish && (
          <p className="text-[13px] text-ink-muted">
            {publishBlocked ?? 'Publishing makes this version live and retires the current live version.'}
          </p>
        )}
      </form>
    </Card>
  );
}

'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { NotebookPen, Pencil, Sparkles } from 'lucide-react';
import { draftConclusionAction, saveConclusionAction } from '../../app/attempts/[id]/actions';
import { CONCLUSION_MAX_LENGTH, cleanConclusion, conclusionParagraphs, type Conclusion } from '../../lib/conclusion';
import { Button, Card, Notice, cn, helpTextClasses } from '../brand';
import { formatDateTime } from './AttemptStatusPill';

// The counsellor's conclusion on a completed assessment: super admins and counsellors write it after going
// through the answers and edit it whenever they want. Plain text; an empty line starts a new paragraph.
// Printed at the end of the report PDF as "Summary and suggestions", so it is written for the client to
// read. "Draft with AI" fills the box with a Gemini draft; nothing is saved until the counsellor saves.
// Never in any notification; coordinators and clients never see it in the apps.

interface ConclusionEditorProps {
  attemptId: string;
  initial: Conclusion | null;
  /** Only once the client has completed the assessment. */
  canWrite: boolean;
  /** GEMINI_API_KEY is set: show "Draft with AI". */
  aiEnabled: boolean;
}

export function ConclusionEditor({ attemptId, initial, canWrite, aiEnabled }: ConclusionEditorProps) {
  const [saved, setSaved] = useState<Conclusion | null>(initial);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initial?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const [drafting, startDrafting] = useTransition();
  const [fromAi, setFromAi] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const dirty = editing && draft.trim() !== (saved?.body ?? '').trim();

  // Ask before leaving the page with unsaved text.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const startEditing = () => {
    setDraft(saved?.body ?? '');
    setError(null);
    setJustSaved(false);
    setEditing(true);
    requestAnimationFrame(() => {
      const el = textarea.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const draftWithAi = () => {
    const current = editing ? draft.trim() : (saved?.body ?? '').trim();
    if (current && !window.confirm('Replace the text in the box with a new AI draft? Nothing is saved until you press Save.')) return;
    setError(null);
    setJustSaved(false);
    startDrafting(async () => {
      const result = await draftConclusionAction(attemptId);
      if (result.error || !result.body) {
        // Errors show inside the editor: open it with the current text.
        if (!editing) {
          setDraft(saved?.body ?? '');
          setEditing(true);
        }
        setError(result.error ?? 'The AI draft could not be made. Please try again in a minute.');
        return;
      }
      setDraft(result.body);
      setFromAi(true);
      setEditing(true);
    });
  };

  const cancel = () => {
    if (dirty && !window.confirm('Discard the changes you have not saved?')) return;
    setEditing(false);
    setError(null);
    setFromAi(false);
  };

  const save = () => {
    const parsed = cleanConclusion(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await saveConclusionAction(attemptId, parsed.body, saved?.updated_at ?? null);
      if (result.error || !result.conclusion) {
        setError(result.error ?? 'The conclusion could not be saved. Please try again.');
        return;
      }
      setSaved(result.conclusion);
      setDraft(result.conclusion.body);
      setEditing(false);
      setFromAi(false);
      setJustSaved(true);
    });
  };

  const length = draft.trim().length;
  const tooLong = length > CONCLUSION_MAX_LENGTH;

  return (
    <Card className="mt-6 p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[20px] font-semibold text-teal">
            <NotebookPen size={20} strokeWidth={2} aria-hidden />
            <span>Counsellor&rsquo;s conclusion</span>
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            Printed at the end of the report PDF as &ldquo;Summary and suggestions&rdquo;. Write it for the client to read.
          </p>
        </div>
        {saved && !editing && canWrite && (
          <div className="flex flex-wrap gap-2">
            {aiEnabled && <AiButton onClick={draftWithAi} loading={drafting} />}
            <Button variant="secondary" size="sm" onClick={startEditing} disabled={drafting}>
              <Pencil size={16} strokeWidth={2} aria-hidden />
              <span>Edit</span>
            </Button>
          </div>
        )}
      </div>

      {!canWrite && !saved ? (
        <p className="text-[15px] text-ink-muted">You can write a conclusion once the client has completed the assessment.</p>
      ) : editing ? (
        <div>
          <label htmlFor="conclusion" className="sr-only">
            Counsellor&rsquo;s conclusion
          </label>
          <textarea
            id="conclusion"
            ref={textarea}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                save();
              }
              if (e.key === 'Escape') cancel();
            }}
            placeholder={'A short summary for the client, how the sessions will work, and two or three first steps.\n\nLeave an empty line to start a new paragraph.'}
            aria-describedby="conclusion-help"
            aria-invalid={!!error || tooLong}
            disabled={pending || drafting}
            spellCheck
            className={cn(
              'block min-h-72 w-full resize-y rounded-input border border-sand bg-white px-4 py-3.5 text-[16px] leading-7 text-ink field-sizing-content',
              'placeholder:text-ink-muted focus:border-teal focus:outline-2 focus:outline-offset-2 focus:outline-coral',
              'disabled:opacity-60'
            )}
          />
          <div id="conclusion-help" className={cn(helpTextClasses, 'flex flex-wrap justify-between gap-x-4 gap-y-1')}>
            <span>Enter starts a new line; an empty line starts a new paragraph. Ctrl + Enter saves.</span>
            <span className={cn('tabular-nums', tooLong && 'font-semibold text-coral-deep')}>
              {length.toLocaleString('en-IN')} / {CONCLUSION_MAX_LENGTH.toLocaleString('en-IN')}
            </span>
          </div>

          {fromAi && !error && (
            <Notice variant="info" className="mt-4">
              AI draft, not saved yet. Read it, change anything that does not fit this client, then save. It is printed in the PDF the client receives.
            </Notice>
          )}

          {error && (
            <Notice variant="error" className="mt-4" role="alert">
              {error}
            </Notice>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={save} loading={pending} loadingText="Saving..." disabled={tooLong || length === 0 || drafting}>
              Save conclusion
            </Button>
            {aiEnabled && <AiButton onClick={draftWithAi} loading={drafting} disabled={pending} />}
            <Button variant="ghost" onClick={cancel} disabled={pending || drafting}>
              Cancel
            </Button>
          </div>
        </div>
      ) : saved ? (
        <div>
          <div className="space-y-4 text-[16px] leading-7 text-ink">
            {conclusionParagraphs(saved.body).map((p, i) => (
              <p key={i} className="whitespace-pre-wrap wrap-break-word">
                {p}
              </p>
            ))}
          </div>
          <p className="mt-5 border-t border-sand pt-3 text-[13px] text-ink-muted" aria-live="polite">
            {justSaved ? 'Saved. ' : ''}Last edited by {saved.updated_by_name}
            <Dot />
            {formatDateTime(saved.updated_at)}
            {saved.updated_at !== saved.created_at && (
              <>
                <Dot />
                First written {formatDateTime(saved.created_at)}
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="rounded-input border border-dashed border-sand bg-cream p-5 text-center sm:p-6">
          <p className="text-[15px] text-ink-soft">No conclusion yet. Write one after going through the answers above.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {aiEnabled && <AiButton onClick={draftWithAi} loading={drafting} />}
            <Button variant="secondary" size="sm" onClick={startEditing} disabled={drafting}>
              <Pencil size={16} strokeWidth={2} aria-hidden />
              <span>Write conclusion</span>
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function AiButton({ onClick, loading, disabled }: { onClick: () => void; loading: boolean; disabled?: boolean }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} loading={loading} loadingText="Drafting..." disabled={disabled}>
      <Sparkles size={16} strokeWidth={2} aria-hidden />
      <span>Draft with AI</span>
    </Button>
  );
}

/** A solid separator dot; the "·" character stays too faint at caption size. */
function Dot() {
  return <span aria-hidden className="mx-2 inline-block h-1 w-1 rounded-full bg-ink align-middle" />;
}

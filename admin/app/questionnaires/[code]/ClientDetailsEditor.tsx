'use client';

import { useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Plus, Save, Trash2 } from 'lucide-react';
import type { ClientDetail, Issue } from '@mfb/questionnaire';
import { Button, Card, Notice, cn, inputClasses, labelClasses } from '../../../components/brand';
import { saveClientDetailsAction } from '../actions';

// The questions asked after the safety questions, where the client types the answer. Not versioned:
// saving changes what clients are asked from now on, and every answer already given keeps the question
// text it was asked with. Super admins and coordinators edit; counsellors read.

interface Row {
  id: string;
  en: string;
  hi: string;
}

const newId = () => `d_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
const toRows = (list: ClientDetail[]): Row[] => list.map((d) => ({ id: d.id, en: d.text.en, hi: d.text.hi ?? '' }));

export function ClientDetailsEditor({ code, details, canEdit }: { code: string; details: ClientDetail[]; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>(() => toRows(details));
  const [saved, setSaved] = useState<Row[]>(() => toRows(details));
  const [errors, setErrors] = useState<{ message: string; list: Issue[] } | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);

  const change = (i: number, patch: Partial<Row>) => {
    setDone(false);
    setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };
  const move = (i: number, by: -1 | 1) => {
    setDone(false);
    setRows((cur) => {
      const next = [...cur];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  };
  const remove = (i: number) => {
    setDone(false);
    setRows((cur) => cur.filter((_, j) => j !== i));
  };
  const add = () => {
    setDone(false);
    setRows((cur) => [...cur, { id: newId(), en: '', hi: '' }]);
  };

  const save = () =>
    startTransition(async () => {
      setErrors(null);
      const list = rows.map((r) => ({ id: r.id, text: { en: r.en.trim(), hi: r.hi.trim() || null } }));
      const r = await saveClientDetailsAction(code, list);
      if (r.error) return setErrors({ message: r.error, list: r.errors ?? [] });
      setSaved(rows);
      setDone(true);
    });

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-[20px] font-semibold leading-[1.3] text-teal">Client details</h2>
      <p className="mt-1 text-[14px] text-ink-soft">
        Asked after the two safety questions, one per screen. The client types each answer (required, up to 1,000 characters). Not scored, no rules, not in
        the report: counsellors and super admins read the answers on the assessment page.
      </p>
      <p className="mt-1 text-[13px] text-ink-muted">
        Not versioned. A change applies at once, also to clients who have not reached these questions yet. Answers already given keep the question as
        it was asked.
      </p>

      {rows.length === 0 && <p className="mt-4 text-[14px] text-ink-muted">No client-details questions. The assessment ends after the safety questions.</p>}

      <ol className="mt-4 space-y-3">
        {rows.map((r, i) =>
          canEdit ? (
            <li key={r.id} className="rounded-input border border-sand bg-cream p-3 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[14px] font-semibold text-ink-muted">Question {i + 1}</span>
                <span className="flex items-center gap-1">
                  <IconButton label="Move up" disabled={i === 0 || pending} onClick={() => move(i, -1)}>
                    <ArrowUp size={16} strokeWidth={2} aria-hidden />
                  </IconButton>
                  <IconButton label="Move down" disabled={i === rows.length - 1 || pending} onClick={() => move(i, 1)}>
                    <ArrowDown size={16} strokeWidth={2} aria-hidden />
                  </IconButton>
                  <IconButton label="Remove" disabled={pending} onClick={() => remove(i)}>
                    <Trash2 size={16} strokeWidth={2} aria-hidden />
                  </IconButton>
                </span>
              </div>
              <label htmlFor={`${r.id}-en`} className={cn(labelClasses, 'mt-2')}>
                English
              </label>
              <textarea id={`${r.id}-en`} rows={2} value={r.en} onChange={(e) => change(i, { en: e.target.value })} className={cn(inputClasses, 'py-2.5')} />
              <label htmlFor={`${r.id}-hi`} className={cn(labelClasses, 'mt-2')}>
                Hindi
              </label>
              <textarea id={`${r.id}-hi`} lang="hi" rows={2} value={r.hi} onChange={(e) => change(i, { hi: e.target.value })} className={cn(inputClasses, 'py-2.5')} />
            </li>
          ) : (
            <li key={r.id} className="rounded-input bg-cream px-3 py-2 text-[15px] text-ink">
              <span className="mr-2 text-ink-muted">{i + 1}.</span>
              {r.en}
              {r.hi && (
                <span lang="hi" className="block text-ink-soft">
                  {r.hi}
                </span>
              )}
            </li>
          )
        )}
      </ol>

      {errors && (
        <Notice variant="error" role="alert" className="mt-4">
          <p>{errors.message}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
            {errors.list.map((e, i) => (
              <li key={i}>
                <span className="font-semibold">{e.where}:</span> {e.message}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {done && !dirty && (
        <Notice variant="info" icon={<CheckCircle2 size={18} strokeWidth={2} />} className="mt-4">
          Saved. Clients are asked these questions from now on.
        </Notice>
      )}

      {canEdit && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={add} disabled={pending}>
            <Plus size={18} strokeWidth={2} aria-hidden />
            <span>Add question</span>
          </Button>
          <Button type="button" onClick={save} disabled={!dirty} loading={pending} loadingText="Saving...">
            <Save size={18} strokeWidth={2} aria-hidden />
            <span>Save client details</span>
          </Button>
        </div>
      )}
    </Card>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-11 items-center justify-center rounded-full text-teal transition-colors hover:bg-mist disabled:opacity-40"
    >
      {children}
    </button>
  );
}

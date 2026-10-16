'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, ArrowRight, Check, Phone } from 'lucide-react';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import { CRISIS_HELPLINES } from '../../../lib/assessment/helplines';
import type { AnswerValue, Interrupt, QuestionView, Step } from '../../../lib/assessment/types';
import { Button, Card, Notice, buttonClasses, cn } from '../../../components/brand';
import { goBackAction, saveAnswerAction, submitAction } from '../actions';
import { pickText } from './AssessmentShell';

export function QuestionRunner({ attemptId, initialStep }: { attemptId: string; initialStep: Step }) {
  const router = useRouter();
  const { lang } = useLanguage();
  const t = translations[lang].assess;
  const [step, setStep] = useState<Step>(initialStep);
  const [interrupt, setInterrupt] = useState<Interrupt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [preparing, setPreparing] = useState(false);

  const answer = (qid: string, value: AnswerValue) =>
    startTransition(async () => {
      setError(null);
      const r = await saveAnswerAction(attemptId, qid, value);
      if (!r.ok) {
        setError(t.error);
        if (r.code === 'NOT_VISIBLE' || r.code === 'WRONG_STATUS') router.refresh();
        return;
      }
      setStep(r.step);
      if (r.interrupt) setInterrupt(r.interrupt);
      window.history.replaceState(null, '', `/assessment/${attemptId}`);
    });

  const back = (fromQid: string | null) =>
    startTransition(async () => {
      setError(null);
      const r = await goBackAction(attemptId, fromQid);
      if (!r.ok) {
        setError(t.error);
        return;
      }
      setStep(r.step);
      if (r.step.kind === 'question') window.history.replaceState(null, '', `/assessment/${attemptId}?q=${r.step.question.qid}`);
    });

  const finish = () =>
    startTransition(async () => {
      setError(null);
      setPreparing(true);
      const r = await submitAction(attemptId);
      if (!r.ok) {
        setPreparing(false);
        setError(t.error);
        return;
      }
      if (r.status === 'completed') router.push(`/report/${attemptId}`);
      else router.refresh();
    });

  if (interrupt) {
    return <CrisisScreen text={pickText(interrupt.text, lang)} onContinue={() => setInterrupt(null)} />;
  }

  return (
    <div>
      {error && (
        <Notice variant="error" role="alert" className="mb-4" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
          {error}
        </Notice>
      )}

      {step.kind === 'question' ? (
        <QuestionCard
          key={step.question.qid}
          question={step.question}
          busy={pending}
          onAnswer={(v) => answer(step.question.qid, v)}
          onBack={() => back(step.question.qid)}
        />
      ) : step.kind === 'finish' ? (
        <Card className="p-6 text-center sm:p-10">
          {preparing ? (
            <p role="status" className="text-[17px] text-ink-soft">
              {t.preparing}
            </p>
          ) : (
            <>
              <h1 className="text-[28px] font-semibold text-teal">{t.finishTitle}</h1>
              <p className="mt-3 text-[16px] leading-6.25 text-ink-soft">{t.finishBody}</p>
              <Button className="mt-6" fullWidth onClick={finish} loading={pending} loadingText={t.preparing}>
                {t.finishButton}
              </Button>
              <button
                type="button"
                onClick={() => back(null)}
                className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-[15px] font-medium text-teal hover:underline"
              >
                <ArrowLeft size={16} strokeWidth={2} aria-hidden />
                {t.back}
              </button>
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function QuestionCard({
  question,
  busy,
  onAnswer,
  onBack,
}: {
  question: QuestionView;
  busy: boolean;
  onAnswer: (value: AnswerValue) => void;
  onBack: () => void;
}) {
  const { lang } = useLanguage();
  const t = translations[lang].assess;
  const heading = useRef<HTMLHeadingElement>(null);
  const multi = question.type === 'multi';
  const [single, setSingle] = useState<string | null>(typeof question.saved === 'string' ? question.saved : null);
  const [chosen, setChosen] = useState<string[]>(Array.isArray(question.saved) ? question.saved : []);

  // New question: back to the top, focus on the question for keyboard and screen-reader users.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, []);

  const label = (o: QuestionView['options'][number]) => (lang === 'hi' ? o.label_hi || o.label_en : o.label_en);
  const pct = question.total ? Math.round(((question.position - 1) / question.total) * 100) : 0;
  const min = question.minChoices ?? 1;
  const max = question.maxChoices ?? question.options.length;


  const ready = multi ? chosen.length >= min && chosen.length <= max : single !== null;
  const submit = () => {
    if (!ready || busy) return;
    onAnswer(multi ? chosen : (single as string));
  };

  const toggle = (code: string, exclusive: boolean) => {
    setChosen((cur) => {
      if (cur.includes(code)) return cur.filter((c) => c !== code);
      if (exclusive) return [code];
      const withoutExclusive = cur.filter((c) => !question.options.find((o) => o.code === c)?.exclusive);
      if (withoutExclusive.length >= max) return withoutExclusive;
      return [...withoutExclusive, code];
    });
  };

  return (
    <section aria-labelledby={`q-${question.qid}`}>
      {/* Progress */}
      <div className="mb-6">
        <p className="mb-2 text-[13px] font-medium text-ink-muted">
          {t.questionOf.replace('{n}', String(question.position)).replace('{m}', String(question.total))}
        </p>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-sand"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={question.total}
          aria-valuenow={question.position - 1}
          aria-label={t.questionOf.replace('{n}', String(question.position)).replace('{m}', String(question.total))}
        >
          <div className="h-full rounded-full bg-teal transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <h1
        id={`q-${question.qid}`}
        ref={heading}
        tabIndex={-1}
        className="text-[22px] font-semibold leading-[1.35] text-ink outline-none sm:text-[26px]"
      >
        {lang === 'hi' ? question.text_hi || question.text_en : question.text_en}
      </h1>

      {multi ? (
        <fieldset className="mt-6">
          <legend className="mb-3 text-[14px] text-ink-muted">
            {max < question.options.length ? t.chooseUpTo.replace('{n}', String(max)) : t.chooseAll}
          </legend>
          <div className="space-y-3">
            {question.options.map((o) => {
              const on = chosen.includes(o.code);
              const blocked = !on && !o.exclusive && chosen.filter((c) => !question.options.find((x) => x.code === c)?.exclusive).length >= max;
              return (
                <label
                  key={o.code}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-center gap-3 rounded-card border-2 bg-white px-4 py-3 text-[17px] text-ink transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral',
                    on ? 'border-teal bg-mist' : 'border-sand hover:border-teal',
                    blocked && 'cursor-not-allowed opacity-50'
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-teal"
                    checked={on}
                    disabled={busy || blocked}
                    onChange={() => toggle(o.code, o.exclusive)}
                  />
                  <span>{label(o)}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : (
        <div role="radiogroup" aria-labelledby={`q-${question.qid}`} className="mt-6 space-y-3">
          {question.options.map((o) => {
            const on = single === o.code;
            return (
              <button
                key={o.code}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => setSingle(o.code)}
                className={cn(
                  'flex min-h-14 w-full items-center justify-between gap-3 rounded-card border-2 bg-white px-5 py-3 text-left text-[17px] font-medium text-ink transition-colors active:scale-[0.99] disabled:opacity-60',
                  on ? 'border-teal bg-mist' : 'border-sand hover:border-teal'
                )}
              >
                <span>{label(o)}</span>
                {on && <Check size={20} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}

      {/* Action bar: pinned to the bottom of the screen so Next is always in thumb reach. */}
      <div className="sticky bottom-0 -mx-4 mt-6 flex items-center gap-3 border-t border-sand bg-cream/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pb-0">
        {question.canGoBack && (
          <Button variant="secondary" onClick={onBack} disabled={busy} aria-label={t.back} className="shrink-0 px-4">
            <ArrowLeft size={18} strokeWidth={2} aria-hidden />
            <span className="hidden sm:inline">{t.back}</span>
          </Button>
        )}
        <Button className="flex-1" disabled={!ready || busy} loading={busy} loadingText={t.saving} onClick={submit}>
          {t.next}
          <ArrowRight size={18} strokeWidth={2} aria-hidden />
        </Button>
      </div>
    </section>
  );
}

/** Full-screen, calm support screen after the self-harm question is answered yes. */
function CrisisScreen({ text, onContinue }: { text: string; onContinue: () => void }) {
  const { lang } = useLanguage();
  const t = translations[lang].assess;
  const heading = useRef<HTMLParagraphElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="support-text" className="fixed inset-0 z-50 overflow-y-auto bg-cream">
      <div className="mx-auto flex min-h-full max-w-160 flex-col justify-center px-5 py-10">
        <Card className="p-6 sm:p-8">
          <p id="support-text" ref={heading} tabIndex={-1} className="text-[18px] leading-7.25 text-ink outline-none">
            {text}
          </p>
          <div className="mt-8 space-y-3">
            {CRISIS_HELPLINES.map((h, i) => (
              <a
                key={h.tel}
                href={`tel:${h.tel}`}
                className={buttonClasses({ variant: i === 0 ? 'primary' : 'secondary', fullWidth: true, className: 'min-h-14 text-[18px]' })}
              >
                <Phone size={20} strokeWidth={2} aria-hidden />
                {t.callNumber.replace('{number}', h.display)}
              </a>
            ))}
          </div>
          <Button variant="ghost" fullWidth className="mt-4" onClick={onContinue}>
            {t.crisisContinue}
          </Button>
        </Card>
      </div>
    </div>
  );
}

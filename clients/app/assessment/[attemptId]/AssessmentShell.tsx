'use client';

import { useFormStatus } from 'react-dom';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import type { LocalPair, Step } from '../../../lib/assessment/types';
import { BinduDot, Button, Card } from '../../../components/brand';
import { giveConsentAction, setLanguageAction } from '../actions';
import { QuestionRunner } from './QuestionRunner';

export interface LanguageQuestion {
  text: LocalPair;
  options: { lang: 'en' | 'hi' | 'both'; label: LocalPair }[];
}

export function pickText(pair: LocalPair | null | undefined, lang: 'en' | 'hi'): string {
  if (!pair) return '';
  return (lang === 'hi' ? pair.hi ?? pair.en : pair.en ?? pair.hi) ?? '';
}

export function AssessmentShell({
  attemptId,
  initialStep,
  language,
}: {
  attemptId: string;
  initialStep: Step;
  language: LanguageQuestion | null;
}) {
  const { lang } = useLanguage();
  const t = translations[lang].assess;

  if (initialStep.kind === 'language' && language) {
    return (
      <section aria-labelledby="language-question">
        <BinduDot className="mb-4" />
        <h1 id="language-question" className="text-[26px] font-semibold leading-[1.3] text-teal sm:text-[30px]">
          {pickText(language.text, lang)}
        </h1>
        <div className="mt-6 space-y-3">
          {language.options.map((o) => (
            <form key={o.lang} action={setLanguageAction}>
              <input type="hidden" name="attemptId" value={attemptId} />
              <input type="hidden" name="lang" value={o.lang} />
              <OptionSubmit label={pickText(o.label, lang)} />
            </form>
          ))}
        </div>
      </section>
    );
  }

  if (initialStep.kind === 'consent') {
    return (
      <Card className="p-6 sm:p-8">
        <BinduDot className="mb-4" />
        <h1 className="text-[26px] font-semibold leading-[1.3] text-teal">{t.consentTitle}</h1>
        <p className="mt-3 text-[17px] leading-[27px] text-ink-soft">{t.consentLine}</p>
        <form action={giveConsentAction} className="mt-6">
          <input type="hidden" name="attemptId" value={attemptId} />
          <ConsentSubmit label={t.consentAgree} busy={t.paying} />
        </form>
      </Card>
    );
  }

  if (initialStep.kind === 'stopped') {
    return (
      <Card className="p-6 text-center sm:p-10">
        <p role="status" className="text-[17px] leading-[28px] text-ink-soft">
          {pickText(initialStep.text, lang)}
        </p>
        <form action="/api/auth/signout" method="POST" className="mt-8">
          <Button type="submit" fullWidth>
            {t.stoppedClose}
          </Button>
        </form>
      </Card>
    );
  }

  return <QuestionRunner attemptId={attemptId} initialStep={initialStep} />;
}

function OptionSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-[56px] w-full items-center rounded-card border border-sand bg-white px-5 py-3 text-left text-[17px] font-medium text-ink shadow-card transition-colors hover:border-teal hover:bg-mist disabled:opacity-60"
    >
      {label}
    </button>
  );
}

function ConsentSubmit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} loadingText={busy}>
      {label}
    </Button>
  );
}

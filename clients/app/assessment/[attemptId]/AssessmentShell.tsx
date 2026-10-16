'use client';

import { useFormStatus } from 'react-dom';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import type { LocalPair, Step } from '../../../lib/assessment/types';
import { BinduDot, Button, Card } from '../../../components/brand';
import { giveConsentAction } from '../actions';
import { QuestionRunner } from './QuestionRunner';

export function pickText(pair: LocalPair | null | undefined, lang: 'en' | 'hi'): string {
  if (!pair) return '';
  return (lang === 'hi' ? pair.hi ?? pair.en : pair.en ?? pair.hi) ?? '';
}

export function AssessmentShell({
  attemptId,
  initialStep,
}: {
  attemptId: string;
  initialStep: Step;
}) {
  const { lang } = useLanguage();
  const t = translations[lang].assess;

  if (initialStep.kind === 'consent') {
    return (
      <Card className="p-6 sm:p-8">
        <BinduDot className="mb-4" />
        <h1 className="text-[26px] font-semibold leading-[1.3] text-teal">{t.consentTitle}</h1>
        <p className="mt-3 text-[17px] leading-6.75 text-ink-soft">{t.consentLine}</p>
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
        <p role="status" className="text-[17px] leading-7 text-ink-soft">
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

function ConsentSubmit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} loadingText={busy}>
      {label}
    </Button>
  );
}

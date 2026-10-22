'use client';

import { useFormStatus } from 'react-dom';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import type { Step } from '../../../lib/assessment/types';
import { BinduDot, Button, Card } from '../../../components/brand';
import { giveConsentAction } from '../actions';
import { QuestionRunner } from './QuestionRunner';
import { CompletedView, type CompletedDetails } from './CompletedView';

export function AssessmentShell({
  attemptId,
  initialStep,
  completed = null,
}: {
  attemptId: string;
  initialStep: Step;
  /** Details for a completed attempt. */
  completed?: CompletedDetails | null;
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

  // Finished: thank-you, what happens next and the payment receipt. The report is never shown here.
  if (initialStep.kind === 'completed') return <CompletedView details={completed} />;

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

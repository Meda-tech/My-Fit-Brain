'use client';

import { useFormStatus } from 'react-dom';
import { AlertCircle, Info } from 'lucide-react';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import type { LocalPair } from '../../../lib/assessment/types';
import { Button, Card, Logo, Notice } from '../../../components/brand';
import { startPurchaseAction } from '../../assessment/actions';

// The only place a price appears (CLAUDE.md). Live payments come in a later task.
const PRICE = '₹3,500';

function PayButton({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" fullWidth loading={pending} loadingText={busy}>
      {label}
    </Button>
  );
}

export function PaymentView({ testCode, name, stub, error }: { testCode: string; name: LocalPair; stub: boolean; error: string | null }) {
  const { lang } = useLanguage();
  const t = translations[lang].assess;
  const title = (lang === 'hi' ? name.hi : name.en) ?? name.en ?? name.hi;

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6">
        <Logo variant="endorsed" tone="colour" width={200} />
      </div>
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t.paymentTitle}</p>
      <h1 className="mt-2 text-[26px] font-semibold leading-[1.25] text-teal sm:text-[30px]">{title}</h1>
      <p className="mt-4 font-heading text-[34px] font-semibold text-ink">{PRICE}</p>
      <p className="mt-2 text-[16px] leading-6.25 text-ink-soft">{t.paymentIncludes}</p>

      {error && (
        <Notice variant="error" role="alert" className="mt-6" icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}>
          {error === 'PAYMENTS_DISABLED' ? t.paymentsClosed : t.error}
        </Notice>
      )}

      {stub ? (
        <form action={startPurchaseAction} className="mt-6">
          <input type="hidden" name="testCode" value={testCode} />
          <PayButton label={t.payTesting} busy={t.paying} />
        </form>
      ) : (
        <Notice variant="info" className="mt-6" icon={<Info size={18} strokeWidth={2} />}>
          {t.paymentsClosed}
        </Notice>
      )}
    </Card>
  );
}

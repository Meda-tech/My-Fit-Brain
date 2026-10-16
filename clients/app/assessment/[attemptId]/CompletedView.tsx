'use client';

import { CheckCircle2, Receipt } from 'lucide-react';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import type { LocalPair } from '../../../lib/assessment/types';
import { ButtonLink, Card } from '../../../components/brand';

// A finished assessment: confirmation, what happens next, and the client's own payment receipt.
// The report is for the care team only and is never shown here (D22). The amount appears only as the
// client's own receipt (CLAUDE.md).

export interface CompletedDetails {
  testName: LocalPair;
  reportId: string | null;
  completedAt: string | null;
  receipt: { amount: string; method: string | null; paymentId: string; paidAt: string } | null;
}

const METHODS: Record<string, string> = {
  upi: 'UPI',
  card: 'Card',
  netbanking: 'Net banking',
  wallet: 'Wallet',
  emi: 'EMI',
  paylater: 'Pay later',
};

export function CompletedView({ details }: { details: CompletedDetails | null }) {
  const { lang } = useLanguage();
  const t = translations[lang].assess;
  const locale = lang === 'hi' ? 'hi-IN' : 'en-IN';
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const name = details ? ((lang === 'hi' ? details.testName.hi : details.testName.en) ?? details.testName.en) : null;
  const receipt = details?.receipt ?? null;

  return (
    <div className="space-y-4">
      <Card className="p-6 text-center sm:p-8">
        <CheckCircle2 size={40} strokeWidth={2} className="mx-auto text-teal" aria-hidden />
        <h1 className="mt-4 text-[26px] font-semibold leading-tight text-teal">{t.completedTitle}</h1>
        {name && <p className="mt-2 text-[16px] font-medium text-ink">{name}</p>}
        <p role="status" className="mt-3 text-[16px] leading-6.5 text-ink-soft">
          {details?.completedAt && <>{t.completedLine.replace('{date}', date(details.completedAt))} </>}
          {t.completedBody}
        </p>
        {details?.reportId && (
          <p className="mt-4 text-[13px] text-ink-muted">
            {t.reference}: <span className="select-all font-mono">{details.reportId}</span>
          </p>
        )}
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[18px] font-semibold text-teal">
            <Receipt size={20} strokeWidth={2} aria-hidden />
            <span>{t.receiptTitle}</span>
          </h2>
          {receipt && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mist px-2.5 py-0.5 text-[12px] font-semibold text-teal">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
              {t.receiptPaid}
            </span>
          )}
        </div>
        {receipt ? (
          <dl className="divide-y divide-sand">
            <Row label={t.amountPaid}>
              <span className="font-heading text-[18px] font-semibold text-ink">{receipt.amount}</span>
            </Row>
            <Row label={t.paidOn}>{dateTime(receipt.paidAt)}</Row>
            <Row label={t.paymentMethod}>{receipt.method ? (METHODS[receipt.method] ?? receipt.method) : '—'}</Row>
            <Row label={t.paymentId}>
              <span className="select-all break-all font-mono text-[13px] text-ink-soft">{receipt.paymentId}</span>
            </Row>
          </dl>
        ) : (
          <p className="text-[15px] text-ink-muted">{t.receiptMissing}</p>
        )}
      </Card>

      <div className="text-center">
        <ButtonLink href="/" variant="secondary">
          {t.backHome}
        </ButtonLink>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-[14px] text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] text-ink">{children}</dd>
    </div>
  );
}

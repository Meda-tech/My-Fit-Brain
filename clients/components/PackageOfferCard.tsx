'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, CalendarDays, CheckCircle2, Info, Lock, Repeat } from 'lucide-react';
import { useLanguage } from './LanguageProvider';
import { translations } from '../lib/i18n';
import { Button, Card, Notice } from './brand';
import type { PackageOfferCard as Offer, PackagePaidCard as Paid } from '../lib/package/server';

// The package offer on Home (step 6): shown once the client's report presentation is done, until the package is
// paid. The server creates the order for the amount it calculates (/api/package/order) and verifies the result
// (/api/package/verify); this card only shows the numbers it was given, opens the checkout and reports back.
// The checkout shows "My Fit Brain" only (discretion rule).

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface CheckoutInstance {
  open(): void;
  on(event: 'payment.failed', handler: () => void): void;
}

type CheckoutConstructor = new (options: Record<string, unknown>) => CheckoutInstance;

function checkoutConstructor(): CheckoutConstructor | undefined {
  return (window as unknown as { Razorpay?: CheckoutConstructor }).Razorpay;
}

function loadCheckout(): Promise<void> {
  if (checkoutConstructor()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Checkout did not load'));
    document.body.appendChild(script);
  });
}

/** The brand teal from the CSS tokens (no hex in components). */
function brandTeal(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-teal').trim();
}

type Status = 'idle' | 'busy' | 'failed' | 'pending' | 'error' | 'limited' | 'closed' | 'paid' | 'duplicate';

function formatDate(iso: string, lang: 'en' | 'hi'): string {
  return new Date(iso).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** "Payment received. Our team will contact you to schedule your sessions." */
export function PackagePaidCard({ paid }: { paid: Paid | null }) {
  const { lang } = useLanguage();
  const t = translations[lang];
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <CheckCircle2 size={28} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold leading-7 text-teal">{t.pkg.paidTitle}</h2>
          <p className="mt-1 text-[16px] leading-6.5 text-ink-soft">{t.pkg.paidBody}</p>
          {paid && (
            <p className="mt-2 text-[13px] text-ink-muted">
              {t.pkg.paidLine.replace('{amount}', paid.amount).replace('{date}', formatDate(paid.paidAt, lang))} ·{' '}
              {t.pkg.sessions.replace('{n}', String(paid.sessions))}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function PackageOfferCard({ offer, enabled, prefillName }: { offer: Offer; enabled: boolean; prefillName: string }) {
  const router = useRouter();
  const { lang } = useLanguage();
  const t = translations[lang];
  const [status, setStatus] = useState<Status>(enabled ? 'idle' : 'closed');
  const verifying = useRef(false);

  const verify = async (result: RazorpaySuccess) => {
    verifying.current = true;
    setStatus('busy');
    try {
      const res = await fetch('/api/package/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: 'paid' | 'duplicate'; code?: string };
      if (data.ok) {
        setStatus(data.result === 'duplicate' ? 'duplicate' : 'paid');
        router.refresh();
        return;
      }
      setStatus(data.code === 'PENDING' ? 'pending' : data.code === 'FAILED' ? 'failed' : 'error');
    } catch {
      setStatus('error');
    } finally {
      verifying.current = false;
    }
  };

  const pay = async () => {
    setStatus('busy');
    try {
      const res = await fetch('/api/package/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchaseId: offer.purchaseId }),
      });
      const order = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        keyId?: string;
        orderId?: string;
        amount?: number;
        currency?: string;
        contact?: string;
      };
      if (!order.ok) {
        // The offer is gone (paid meanwhile, e.g. recorded by the team): show what is true now.
        if (order.code === 'NOT_FOUND') {
          router.refresh();
          setStatus('idle');
          return;
        }
        setStatus(order.code === 'NOT_CONFIGURED' ? 'closed' : order.code === 'RATE_LIMITED' ? 'limited' : 'error');
        return;
      }
      await loadCheckout();
      const Checkout = checkoutConstructor();
      if (!Checkout) throw new Error('Checkout unavailable');
      const checkout = new Checkout({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'My Fit Brain',
        description: 'My Fit Brain',
        prefill: { contact: order.contact, name: prefillName },
        theme: { color: brandTeal() },
        handler: (result: RazorpaySuccess) => void verify(result),
        modal: {
          // Closed without paying: back to the button.
          ondismiss: () => {
            if (!verifying.current) setStatus('idle');
          },
          confirm_close: true,
        },
      });
      checkout.on('payment.failed', () => setStatus('failed'));
      checkout.open();
    } catch {
      setStatus('error');
    }
  };

  if (status === 'paid') return <PackagePaidCard paid={null} />;

  const message =
    status === 'failed'
      ? { variant: 'error' as const, text: t.assess.payFailed }
      : status === 'pending'
        ? { variant: 'info' as const, text: t.pkg.pending }
        : status === 'error'
          ? { variant: 'error' as const, text: t.pkg.error }
          : status === 'limited'
            ? { variant: 'error' as const, text: t.pkg.limited }
            : status === 'duplicate'
              ? { variant: 'info' as const, text: t.pkg.duplicate }
              : status === 'closed'
                ? { variant: 'info' as const, text: t.assess.paymentsClosed }
                : null;

  return (
    <Card className="overflow-hidden">
      <p className="flex items-center gap-2 bg-mist px-5 py-3 text-[14px] font-semibold text-teal sm:px-6">
        <CheckCircle2 size={18} strokeWidth={2} aria-hidden />
        <span>{t.pkg.done}</span>
      </p>
      <div className="p-5 sm:p-6">
        <h2 className="text-[24px] font-semibold leading-[1.25] text-teal sm:text-[26px]">{t.pkg.title}</h2>
        <ul className="mt-3 flex flex-wrap gap-2 text-[14px] font-medium text-ink">
          <li className="inline-flex items-center gap-1.5 rounded-full bg-cream px-3 py-1.5">
            <CalendarDays size={15} strokeWidth={2} className="text-teal" aria-hidden />
            {t.pkg.sessions.replace('{n}', String(offer.sessions))}
          </li>
          <li lang="en" className="inline-flex items-center gap-1.5 rounded-full bg-cream px-3 py-1.5">
            <Repeat size={15} strokeWidth={2} className="text-teal" aria-hidden />
            {offer.frequency}
          </li>
        </ul>

        <dl className="mt-5 grid gap-2 text-[15px]">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-soft">{t.pkg.price}</dt>
            <dd className="m-0 font-medium text-ink">{offer.price}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-soft">{t.pkg.advance}</dt>
            <dd className="m-0 font-medium text-ink">− {offer.advance}</dd>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-sand pt-3">
            <dt className="font-semibold text-ink">{t.pkg.payNow}</dt>
            <dd className="m-0 font-heading text-[26px] font-semibold leading-none text-teal">{offer.amount}</dd>
          </div>
        </dl>

        {message && (
          <Notice
            variant={message.variant}
            role={message.variant === 'error' ? 'alert' : 'status'}
            className="mt-5"
            icon={
              message.variant === 'error' ? (
                <AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />
              ) : (
                <Info size={18} strokeWidth={2} />
              )
            }
          >
            {message.text}
          </Notice>
        )}

        {status !== 'closed' && status !== 'pending' && status !== 'duplicate' && (
          <>
            <Button className="mt-5" fullWidth onClick={pay} loading={status === 'busy'} loadingText={t.assess.paying}>
              {t.assess.pay.replace('{price}', offer.amount)}
            </Button>
            <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-ink-muted">
              <Lock size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
              <span>{t.assess.paySecure}</span>
            </p>
            <p className="mt-2 text-[13px] leading-5 text-ink-muted">
              {t.assess.payAgree.split(/(\{terms\}|\{refund\})/).map((part, i) =>
                part === '{terms}' ? (
                  <Link key={i} href="/terms" className="font-medium text-teal underline underline-offset-2">
                    {t.assess.payTerms}
                  </Link>
                ) : part === '{refund}' ? (
                  <Link key={i} href="/refund-policy" className="font-medium text-teal underline underline-offset-2">
                    {t.assess.payRefund}
                  </Link>
                ) : (
                  part
                )
              )}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

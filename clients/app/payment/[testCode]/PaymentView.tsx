'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Info, Lock } from 'lucide-react';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import { pick, type Text } from '@mfb/questionnaire';
import { Button, ButtonLink, Card, Logo, Notice } from '../../../components/brand';

// Razorpay Standard Checkout. The server creates the order (/api/payments/order) and verifies the
// result (/api/payments/verify); this screen only opens the checkout and reports back. The checkout
// shows "My Fit Brain · MFB Assessment" only (discretion rule).

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', handler: () => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
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

type Status = 'idle' | 'busy' | 'failed' | 'pending' | 'error' | 'closed';

export function PaymentView({
  testCode,
  name,
  price,
  enabled,
  prefill,
}: {
  testCode: string;
  name: Text;
  price: string;
  enabled: boolean;
  prefill: { name: string; email: string; contact: string };
}) {
  const router = useRouter();
  const { lang } = useLanguage();
  const t = translations[lang].assess;
  const title = pick(name, lang);
  const [status, setStatus] = useState<Status>(enabled ? 'idle' : 'closed');
  const verifying = useRef(false);

  const verify = async (result: RazorpaySuccess) => {
    verifying.current = true;
    setStatus('busy');
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; attemptId?: string; code?: string };
      if (data.ok && data.attemptId) {
        router.push(`/assessment/${data.attemptId}`);
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
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCode }),
      });
      const order = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        kind?: 'open' | 'order';
        attemptId?: string;
        keyId?: string;
        orderId?: string;
        amount?: number;
        currency?: string;
      };
      if (!order.ok) {
        setStatus(order.code === 'NOT_CONFIGURED' ? 'closed' : 'error');
        return;
      }
      // Already paid and not finished: continue that assessment instead of paying again.
      if (order.kind === 'open' && order.attemptId) {
        router.push(`/assessment/${order.attemptId}`);
        return;
      }

      await loadCheckout();
      if (!window.Razorpay) throw new Error('Checkout unavailable');
      const checkout = new window.Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amount,
        currency: order.currency,
        name: 'My Fit Brain',
        description: 'MFB Assessment',
        prefill,
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

  const message =
    status === 'failed'
      ? { variant: 'error' as const, text: t.payFailed }
      : status === 'pending'
        ? { variant: 'info' as const, text: t.payPending }
        : status === 'error'
          ? { variant: 'error' as const, text: t.payError }
          : status === 'closed'
            ? { variant: 'info' as const, text: t.paymentsClosed }
            : null;

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6">
        <Logo variant="endorsed" tone="colour" width={200} />
      </div>
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t.paymentTitle}</p>
      <h1 className="mt-2 text-[26px] font-semibold leading-[1.25] text-teal sm:text-[30px]">{title}</h1>
      {/* The only place a price appears (CLAUDE.md). */}
      <p className="mt-4 font-heading text-[34px] font-semibold text-ink">{price}</p>
      <p className="mt-2 text-[16px] leading-6.5 text-ink-soft">{t.paymentIncludes}</p>

      {message && (
        <Notice
          variant={message.variant}
          role={message.variant === 'error' ? 'alert' : 'status'}
          className="mt-6"
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

      {status === 'pending' ? (
        <ButtonLink href="/" variant="secondary" className="mt-6">
          {t.backHome}
        </ButtonLink>
      ) : (
        status !== 'closed' && (
          <>
            <Button className="mt-6" fullWidth onClick={pay} loading={status === 'busy'} loadingText={t.paying}>
              {t.pay.replace('{price}', price)}
            </Button>
            <p className="mt-3 flex items-start gap-2 text-[13px] leading-5 text-ink-muted">
              <Lock size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
              <span>{t.paySecure}</span>
            </p>
          </>
        )
      )}
    </Card>
  );
}

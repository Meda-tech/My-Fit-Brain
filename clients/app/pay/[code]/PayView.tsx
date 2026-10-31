'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Info, Lock } from 'lucide-react';
import { useLanguage } from '../../../components/LanguageProvider';
import { translations } from '../../../lib/i18n';
import { maskPhoneNumber, normalizePhoneNumber, sanitizeIndianNationalPhone } from '../../../lib/phone';
import { LOGIN_PHONE_KEY } from '../../../lib/login-phone';
import { pick, type Text } from '@mfb/questionnaire';
import { Button, Card, Logo, Notice, inputGroupClasses, labelClasses } from '../../../components/brand';
import { FeatureList, PriceTag } from '../../../components/AssessmentOffer';

// Pay first, log in later. The server creates the order (/api/payments/order) and verifies the result
// (/api/payments/verify); this screen only asks the phone number, opens the checkout and reports back.
// The checkout shows "My Fit Brain · MFB Assessment" only (discretion rule).

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

type Status = 'idle' | 'busy' | 'failed' | 'pending' | 'error' | 'limited' | 'closed';

export function PayView({
  code,
  name,
  subtitle,
  price,
  regularPrice,
  enabled,
  signedInPhone,
  prefill,
}: {
  code: string;
  name: Text;
  subtitle: Text | null;
  price: string;
  /** Shown struck through; never charged. */
  regularPrice: string;
  enabled: boolean;
  /** A signed-in client always pays for their own verified number (E.164). */
  signedInPhone: string | null;
  prefill: { name: string } | null;
}) {
  const router = useRouter();
  const { lang } = useLanguage();
  const t = translations[lang];
  const title = pick(name, lang);
  const [status, setStatus] = useState<Status>(enabled ? 'idle' : 'closed');
  const [rawPhone, setRawPhone] = useState('');
  /** Masked number shown after a successful payment. */
  const [paidFor, setPaidFor] = useState<string | null>(null);
  const verifying = useRef(false);

  const phone = normalizePhoneNumber(signedInPhone ?? rawPhone);

  const verify = async (result: RazorpaySuccess) => {
    verifying.current = true;
    setStatus('busy');
    try {
      const res = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; next?: 'home' | 'login'; phone?: string; code?: string };
      if (data.ok && data.next === 'home') {
        router.push('/');
        return;
      }
      if (data.ok) {
        setPaidFor(data.phone ?? maskPhoneNumber(phone.normalized));
        return;
      }
      setStatus(data.code === 'PENDING' ? 'pending' : data.code === 'FAILED' ? 'failed' : 'error');
    } catch {
      setStatus('error');
    } finally {
      verifying.current = false;
    }
  };

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phone.valid) return;
    setStatus('busy');
    try {
      const res = await fetch('/api/payments/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, phone: phone.normalized }),
      });
      const order = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        code?: string;
        kind?: 'owned' | 'order';
        keyId?: string;
        orderId?: string;
        amount?: number;
        currency?: string;
        contact?: string;
      };
      if (!order.ok) {
        setStatus(order.code === 'NOT_CONFIGURED' ? 'closed' : order.code === 'RATE_LIMITED' ? 'limited' : 'error');
        return;
      }
      // Signed in and already holding this assessment: it is on Home.
      if (order.kind === 'owned') {
        router.push('/');
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
        prefill: { contact: order.contact, ...(prefill ? { name: prefill.name } : {}) },
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

  const goToLogin = () => {
    try {
      // The login screen fills the number in once (this tab only).
      sessionStorage.setItem(LOGIN_PHONE_KEY, phone.normalized);
    } catch {
      // Storage blocked: the client types the number again.
    }
    router.push('/login');
  };

  if (paidFor) {
    return (
      <Card className="p-6 sm:p-8">
        <CheckCircle2 size={40} strokeWidth={2} className="text-teal" aria-hidden />
        <h1 className="mt-4 text-[26px] font-semibold leading-[1.25] text-teal sm:text-[30px]">{t.pay.paidTitle}</h1>
        <p className="mt-3 text-[16px] leading-6.5 text-ink-soft">
          {t.pay.paidBody.split('{phone}').map((part, i) =>
            i === 0 ? (
              part
            ) : (
              <span key={i}>
                <span className="whitespace-nowrap font-mono font-semibold text-ink">{paidFor}</span>
                {part}
              </span>
            )
          )}
        </p>
        <Button className="mt-6" fullWidth onClick={goToLogin}>
          <span>{t.pay.paidLogin}</span>
          <ArrowRight size={18} strokeWidth={2} aria-hidden />
        </Button>
      </Card>
    );
  }

  const message =
    status === 'failed'
      ? { variant: 'error' as const, text: t.assess.payFailed }
      : status === 'pending'
        ? { variant: 'info' as const, text: t.pay.pending }
        : status === 'error'
          ? { variant: 'error' as const, text: t.pay.error }
          : status === 'limited'
            ? { variant: 'error' as const, text: t.pay.limited }
            : status === 'closed'
              ? { variant: 'info' as const, text: t.assess.paymentsClosed }
              : null;

  return (
    <Card className="p-6 sm:p-8">
      <div className="mb-6">
        <Logo variant="endorsed" tone="colour" width={200} />
      </div>
      <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">{t.assess.paymentTitle}</p>
      <h1 className="mt-2 text-[26px] font-semibold leading-[1.25] text-teal sm:text-[30px]">{title}</h1>
      <p lang="en" className="mt-1 text-[13px] text-ink-muted">
        {t.brand.endorsement}
      </p>
      {subtitle && <p className="mt-4 text-[16px] leading-6.5 text-ink-soft">{pick(subtitle, lang)}</p>}
      {/* The only place a price appears in the app (CLAUDE.md). */}
      <PriceTag
        className="mt-5"
        price={price}
        regular={regularPrice}
        regularLabel={t.pay.regularPrice}
        offerLabel={t.pay.offerPrice}
      />
      <FeatureList className="mt-6 border-t border-sand pt-5" title={t.pay.featuresTitle} items={t.pay.features} />

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

      {status === 'pending' && (
        <Button variant="secondary" className="mt-6" fullWidth onClick={goToLogin}>
          {t.pay.paidLogin}
        </Button>
      )}

      {status !== 'closed' && status !== 'pending' && (
        <form onSubmit={pay} className="mt-6">
          {signedInPhone ? (
            <p className="text-[15px] leading-6 text-ink-soft">
              {t.pay.forYourNumber}{' '}
              <span className="whitespace-nowrap font-mono font-semibold text-ink">{maskPhoneNumber(signedInPhone)}</span>
            </p>
          ) : (
            <div>
              <label htmlFor="pay-phone" className={labelClasses}>
                {t.login.phoneLabel}
              </label>
              {/* Same input and validation as the login screen. */}
              <div className={inputGroupClasses}>
                <span className="select-none shrink-0 border-r border-sand pr-3 font-mono text-[16px] font-medium text-ink-soft">
                  +91
                </span>
                <input
                  id="pay-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  enterKeyHint="go"
                  required
                  maxLength={10}
                  value={rawPhone}
                  onChange={(e) => setRawPhone(sanitizeIndianNationalPhone(e.target.value))}
                  placeholder="98765 43210"
                  aria-describedby="pay-phone-hint"
                  className="no-inner-outline min-h-11.5 min-w-0 flex-1 border-none bg-transparent pl-3 font-mono text-[17px] tracking-wider text-ink placeholder:font-body placeholder:text-ink-muted"
                />
              </div>
              {rawPhone && phone.valid && (
                <p className="mt-1.5 flex items-center gap-1 font-mono text-[13px] text-teal">
                  <CheckCircle2 size={14} strokeWidth={2} aria-hidden />
                  <span>{phone.formatted}</span>
                </p>
              )}
              {rawPhone.length === 10 && !phone.valid && (
                <p className="mt-1.5 flex items-center gap-1 text-[13px] text-coral-deep">
                  <AlertCircle size={14} strokeWidth={2} aria-hidden />
                  <span>{phone.error}</span>
                </p>
              )}
              <p id="pay-phone-hint" className="mt-2 text-[14px] leading-5.5 text-ink-soft">
                {t.pay.phoneHint}
              </p>
            </div>
          )}

          <Button
            type="submit"
            className="mt-6"
            fullWidth
            loading={status === 'busy'}
            loadingText={t.assess.paying}
            disabled={!phone.valid}
          >
            {t.assess.pay.replace('{price}', price)}
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
        </form>
      )}
    </Card>
  );
}

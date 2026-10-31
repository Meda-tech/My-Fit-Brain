'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ArrowRight,
  Info,
  Check,
  ArrowLeft,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { createClient } from '../../lib/supabase/client';
import { checkPhoneStatus } from '../../lib/services/client-auth';
import { normalizePhoneNumber, maskPhoneNumber, sanitizeIndianNationalPhone } from '../../lib/phone';
import { LOGIN_PHONE_KEY } from '../../lib/login-phone';
import { translations } from '../../lib/i18n';
import { useLanguage } from '../../components/LanguageProvider';
import { ClientAuthLayout } from '../../components/ClientAuthLayout';
import {
  Button,
  Notice,
  inputClasses,
  inputGroupClasses,
  labelClasses,
} from '../../components/brand';

export function ClientLoginFlow() {
  const router = useRouter();
  const { lang, setLang } = useLanguage();
  const t = translations[lang];

  // Step 1: 'phone' | Step 2: 'otp'
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [rawPhone, setRawPhone] = useState('');
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [isExistingClient, setIsExistingClient] = useState<boolean | null>(null);

  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resend cooldown timer
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCountdown > 0) {
      timer = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCountdown]);

  // Coming from a payment: fill in the number that was paid for (read once).
  useEffect(() => {
    try {
      const paid = sessionStorage.getItem(LOGIN_PHONE_KEY);
      if (!paid) return;
      sessionStorage.removeItem(LOGIN_PHONE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage exists only after mount
      setRawPhone(sanitizeIndianNationalPhone(paid));
    } catch {
      // Storage blocked: the client types the number.
    }
  }, []);

  const phoneValidation = normalizePhoneNumber(rawPhone);

  // Send OTP
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!phoneValidation.valid) {
      setErrorMsg(phoneValidation.error || t.login.errors.invalidPhone);
      return;
    }

    try {
      setLoading(true);

      // 1. Determine if phone belongs to existing record without exposing details
      const status = await checkPhoneStatus(phoneValidation.normalized);
      setIsExistingClient(status.exists);
      setNormalizedPhone(phoneValidation.normalized);

      // 2. Request OTP via Supabase Auth
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        phone: phoneValidation.normalized,
      });

      if (error) {
        console.error('Supabase OTP error:', error);
        setErrorMsg(error.message || t.login.errors.general);
        setLoading(false);
        return;
      }

      setStep('otp');
      setResendCountdown(30);
      setLoading(false);
    } catch (err: unknown) {
      console.error('Unexpected OTP request error:', err);
      setErrorMsg(t.login.errors.general);
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (resendCountdown > 0 || !normalizedPhone) return;
    setErrorMsg(null);

    try {
      setLoading(true);
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalizedPhone,
      });

      if (error) {
        setErrorMsg(error.message || t.login.errors.general);
      } else {
        setResendCountdown(30);
      }
    } catch {
      setErrorMsg(t.login.errors.general);
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanOtp = otp.trim();
    if (cleanOtp.length < 6) {
      setErrorMsg(t.login.errors.invalidOtp);
      return;
    }

    try {
      setLoading(true);
      const supabase = createClient();

      const { data, error } = await supabase.auth.verifyOtp({
        phone: normalizedPhone,
        token: cleanOtp,
        type: 'sms',
      });

      if (error || !data.user) {
        console.error('OTP verification failed:', error);
        setErrorMsg(t.login.errors.invalidOtp);
        setLoading(false);
        return;
      }

      // Authentication successful: refresh session state and navigate to home page.
      // Server-side requireClient() automatically links pre-created staff records.
      router.refresh();
      router.push('/');
    } catch (err: unknown) {
      console.error('Unexpected verify error:', err);
      setErrorMsg(t.login.errors.general);
      setLoading(false);
    }
  };

  return (
    <ClientAuthLayout lang={lang} onLanguageChange={setLang}>
      <div className="mb-8">
        <h1 className="m-0 text-[30px] font-semibold leading-[1.2] text-teal sm:text-[36px]">
          {step === 'phone' ? t.login.title : t.login.titleOtp}
        </h1>
        <p className="mt-2 text-[16px] leading-6 text-ink-soft">
          {step === 'phone' ? (
            t.login.subtitle
          ) : (
            <>
              {t.login.subtitleOtp}{' '}
              <span className="whitespace-nowrap font-mono font-semibold text-ink">
                {maskPhoneNumber(normalizedPhone)}
              </span>
            </>
          )}
        </p>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <Notice
          variant="error"
          role="alert"
          icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
          className="mb-5"
        >
          {errorMsg}
        </Notice>
      )}

      {/* STEP 1: Phone Input Form */}
      {step === 'phone' && (
        <form onSubmit={handleSendOtp} className="space-y-5">
          <div>
            <label htmlFor="mobile-phone" className={labelClasses}>
              {t.login.phoneLabel}
            </label>
            <div className={inputGroupClasses}>
              <span className="select-none shrink-0 border-r border-sand pr-3 font-mono text-[16px] font-medium text-ink-soft">
                +91
              </span>
              <input
                id="mobile-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                enterKeyHint="send"
                required
                maxLength={10}
                value={rawPhone}
                onChange={(e) => setRawPhone(sanitizeIndianNationalPhone(e.target.value))}
                placeholder="98765 43210"
                className="no-inner-outline min-h-11.5 min-w-0 flex-1 border-none bg-transparent pl-3 font-mono text-[17px] tracking-wider text-ink placeholder:font-body placeholder:text-ink-muted"
              />
            </div>

            {rawPhone && phoneValidation.valid && (
              <p className="mt-1.5 flex items-center gap-1 font-mono text-[13px] text-teal">
                <CheckCircle2 size={14} strokeWidth={2} aria-hidden />
                <span>{phoneValidation.formatted}</span>
              </p>
            )}
            {rawPhone.length === 10 && !phoneValidation.valid && (
              <p className="mt-1.5 flex items-center gap-1 text-[13px] text-coral-deep">
                <AlertCircle size={14} strokeWidth={2} aria-hidden />
                <span>{phoneValidation.error}</span>
              </p>
            )}
          </div>

          <Button
            type="submit"
            fullWidth
            loading={loading}
            loadingText={t.login.sendingCode}
            disabled={!phoneValidation.valid}
          >
            <span>{t.login.sendCodeBtn}</span>
            <ArrowRight size={18} strokeWidth={2} aria-hidden />
          </Button>
        </form>
      )}

      {/* STEP 2: OTP Verification Form */}
      {step === 'otp' && (
        <form onSubmit={handleVerifyOtp} className="space-y-5">
          <Notice variant="info" icon={<Info size={18} strokeWidth={2} />}>
            {isExistingClient ? t.login.existingClientWelcome : t.login.newClientNotice}
          </Notice>

          <div>
            <label htmlFor="otp-code" className={labelClasses}>
              {t.login.otpLabel}
            </label>
            <input
              id="otp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              enterKeyHint="done"
              maxLength={6}
              required
              autoFocus
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              className={`${inputClasses} text-center font-mono text-[24px] font-semibold tracking-[0.4em]`}
            />
          </div>

          <Button
            type="submit"
            fullWidth
            loading={loading}
            loadingText={t.login.verifying}
            disabled={otp.length < 6}
          >
            <span>{t.login.verifyBtn}</span>
            <Check size={18} strokeWidth={2} aria-hidden />
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 px-3"
              onClick={() => {
                setStep('phone');
                setOtp('');
                setErrorMsg(null);
              }}
            >
              <ArrowLeft size={16} strokeWidth={2} aria-hidden />
              <span>{t.login.changePhone}</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="-mr-3 px-3"
              onClick={handleResendOtp}
              disabled={resendCountdown > 0 || loading}
            >
              {resendCountdown > 0
                ? `${t.login.resendWait} ${resendCountdown}s`
                : t.login.resendCode}
            </Button>
          </div>
        </form>
      )}

      {/* Confidentiality Notice */}
      <p className="mt-8 flex items-center gap-2 border-t border-sand pt-6 text-[14px] leading-5.5 text-ink-muted lg:hidden">
        <Lock size={16} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
        <span>{t.common.confidentialityNote}</span>
      </p>
    </ClientAuthLayout>
  );
}

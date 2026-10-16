'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Lock, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { createClient } from '../../lib/supabase/client';
import { AuthLayout } from '../../components/AuthLayout';
import { Button, Notice, inputClasses, labelClasses } from '../../components/brand';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email || !password) {
      setErrorMessage('Please enter both email and password.');
      return;
    }

    try {
      setLoading(true);
      const supabase = createClient();

      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message || 'Invalid email or password.');
        setLoading(false);
        return;
      }

      if (data.user) {
        // Refresh router so server middleware sees session cookie
        router.push('/dashboard');
        router.refresh();
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'An error occurred during sign in.'
      );
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="m-0 text-[32px] font-semibold leading-[1.2] text-teal sm:text-[36px]">
          Welcome back
        </h1>
        <p className="mt-2 text-[16px] leading-6 text-ink-soft">
          Sign in to the My Fit Brain staff portal.
        </p>
      </div>

      {errorMessage && (
        <Notice
          variant="error"
          role="alert"
          icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
          className="mb-5"
        >
          {errorMessage}
        </Notice>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="staff-email" className={labelClasses}>
            Email address
          </label>
          <div className="relative">
            <input
              id="staff-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className={`${inputClasses} bg-white pl-11`}
            />
            <Mail
              size={18}
              strokeWidth={2}
              aria-hidden
              className="pointer-events-none absolute left-4 top-3.75 text-teal"
            />
          </div>
        </div>

        <div>
          <label htmlFor="staff-password" className={labelClasses}>
            Password
          </label>
          <div className="relative">
            <input
              id="staff-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className={`${inputClasses} bg-white pl-11 pr-12`}
            />
            <Lock
              size={18}
              strokeWidth={2}
              aria-hidden
              className="pointer-events-none absolute left-4 top-3.75 text-teal"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-mist hover:text-teal"
            >
              {showPassword ? (
                <EyeOff size={18} strokeWidth={2} aria-hidden />
              ) : (
                <Eye size={18} strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
        </div>

        <Button type="submit" fullWidth loading={loading} loadingText="Signing in..." className="!mt-6">
          <span>Sign in</span>
          <ArrowRight size={18} strokeWidth={2} aria-hidden />
        </Button>
      </form>

      <p className="mt-8 border-t border-sand pt-6 text-[14px] leading-5.5 text-ink-muted">
        For My Fit Brain staff only. Client information stays private.
      </p>
    </AuthLayout>
  );
}

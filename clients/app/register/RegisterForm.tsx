'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, AlertCircle, Check } from 'lucide-react';
import { completeRegistration, RegisterErrorCode } from '../../lib/services/client-auth';
import { translations, Language } from '../../lib/i18n';
import {
  GENDERS,
  RELATIONSHIP_STATUSES,
  MAX_AGE,
  MIN_AGE,
  isGender,
  isRelationshipStatus,
} from '../../lib/options';
import { formatDisplayPhone } from '../../lib/phone';
import {
  Button,
  Notice,
  inputClasses,
  labelClasses,
} from '../../components/brand';

interface RegisterFormProps {
  userPhone: string;
  lang: Language;
  /** Called when the age is under 18. Nothing has been saved. */
  onAgeStop: () => void;
}

type FieldName = 'fullName' | 'gender' | 'relationshipStatus' | 'age' | 'email';
type FieldErrors = Partial<Record<FieldName, true>>;

const FIELD_NAMES: readonly FieldName[] = ['fullName', 'gender', 'relationshipStatus', 'age', 'email'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isFieldName(code: RegisterErrorCode): code is FieldName {
  return (FIELD_NAMES as readonly string[]).includes(code);
}

export function RegisterForm({ userPhone, lang, onAgeStop }: RegisterFormProps) {
  const router = useRouter();
  const t = translations[lang];

  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState('');
  const [age, setAge] = useState('');
  const [maritalStatus, setMaritalStatus] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [email, setEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  // Form-level message. Never a database message.
  const [formError, setFormError] = useState<'generic' | 'phoneTaken' | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Mirrors the server action, which is the authority.
    const trimmedAge = age.trim();
    const parsedAge = /^\d+$/.test(trimmedAge) ? Number(trimmedAge) : NaN;
    const ageValid = Number.isInteger(parsedAge) && parsedAge >= 1 && parsedAge <= MAX_AGE;

    // Under 18: the server keeps a minimal record (number, name, age) for refunds and answers ageStop.
    // Only the name is needed first.
    if (ageValid && parsedAge < MIN_AGE) {
      if (fullName.trim().length < 2) {
        setFieldErrors({ fullName: true });
        return;
      }
      setLoading(true);
      try {
        await completeRegistration({ fullName, gender, age: parsedAge, maritalStatus });
      } catch (err: unknown) {
        console.error('Recording the age stop failed:', err);
      }
      onAgeStop();
      return;
    }

    const errors: FieldErrors = {};
    if (fullName.trim().length < 2) errors.fullName = true;
    if (!isGender(gender)) errors.gender = true;
    if (!isRelationshipStatus(maritalStatus)) errors.relationshipStatus = true;
    if (!ageValid) errors.age = true;
    if (email.trim() && !EMAIL_PATTERN.test(email.trim())) errors.email = true;

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    try {
      setLoading(true);
      const res = await completeRegistration({
        fullName,
        gender,
        age: parsedAge,
        maritalStatus,
        city: city.trim() || undefined,
        state: state.trim() || undefined,
        email: email.trim() || undefined,
      });

      if (res.ageStop) {
        onAgeStop();
        return;
      }

      if (!res.success) {
        const code = res.error ?? 'generic';
        if (isFieldName(code)) {
          setFieldErrors({ [code]: true });
        } else {
          setFormError(code === 'phoneTaken' ? 'phoneTaken' : 'generic');
        }
        setLoading(false);
        return;
      }

      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      console.error('Registration failed:', err);
      setFormError('generic');
      setLoading(false);
    }
  };

  const fieldError = (name: FieldName) =>
    fieldErrors[name] ? (
      <p id={`${name}-error`} className="mt-1.5 text-[13px] text-coral-deep">
        {t.register.errors[name]}
      </p>
    ) : null;

  const invalidProps = (name: FieldName) =>
    fieldErrors[name]
      ? { 'aria-invalid': true as const, 'aria-describedby': `${name}-error` }
      : {};

  const requiredMark = <span className="text-coral-deep" aria-hidden>*</span>;

  return (
    <div>
      {/* Headline */}
      <div className="mb-6">
        <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-coral-deep">
          {t.register.eyebrow}
        </p>
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.2] text-teal sm:text-[36px]">
          {t.register.title}
        </h1>
        <p className="mt-2 text-[16px] leading-6 text-ink-soft">
          {t.register.subtitle}
        </p>
      </div>

      {/* Verified Phone Display Badge */}
      <div className="mb-6 p-3 rounded-input bg-mist text-teal text-[14px] flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 font-medium">
          <CheckCircle2 size={16} strokeWidth={2} aria-hidden />
          <span>{t.register.verifiedPhone}</span>
        </span>
        <span className="font-mono font-semibold">
          {formatDisplayPhone(userPhone)}
        </span>
      </div>

      {formError && (
        <Notice
          variant="error"
          role="alert"
          icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
          className="mb-5"
        >
          {t.register.errors[formError]}
        </Notice>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Full Name */}
        <div>
          <label htmlFor="full-name" className={labelClasses}>
            {t.register.fullName} {requiredMark}
          </label>
          <input
            id="full-name"
            type="text"
            autoComplete="name"
            enterKeyHint="next"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={t.register.fullNamePlaceholder}
            className={`${inputClasses} bg-white`}
            {...invalidProps('fullName')}
          />
          {fieldError('fullName')}
        </div>

        {/* Gender (question I2) & Age */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="gender" className={labelClasses}>
              {t.register.gender} {requiredMark}
            </label>
            <select
              id="gender"
              required
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className={`${inputClasses} bg-white`}
              {...invalidProps('gender')}
            >
              <option value="" disabled>
                {t.register.choose}
              </option>
              {GENDERS.map((value) => (
                <option key={value} value={value}>
                  {t.options.gender[value]}
                </option>
              ))}
            </select>
            {fieldError('gender')}
          </div>

          <div>
            <label htmlFor="age" className={labelClasses}>
              {t.register.age} {requiredMark}
            </label>
            <input
              id="age"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_AGE}
              step={1}
              required
              value={age}
              onChange={(e) => setAge(e.target.value)}
              className={`${inputClasses} bg-white`}
              {...invalidProps('age')}
            />
            {fieldError('age')}
          </div>
        </div>

        {/* Relationship status (question I3) */}
        <div>
          <label htmlFor="marital-status" className={labelClasses}>
            {t.register.relationshipStatus} {requiredMark}
          </label>
          <select
            id="marital-status"
            required
            value={maritalStatus}
            onChange={(e) => setMaritalStatus(e.target.value)}
            className={`${inputClasses} bg-white`}
            {...invalidProps('relationshipStatus')}
          >
            <option value="" disabled>
              {t.register.choose}
            </option>
            {RELATIONSHIP_STATUSES.map((value) => (
              <option key={value} value={value}>
                {t.options.relationship[value]}
              </option>
            ))}
          </select>
          {fieldError('relationshipStatus')}
        </div>

        {/* City & State (Optional) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="city" className={labelClasses}>
              {t.register.city}
            </label>
            <input
              id="city"
              type="text"
              autoComplete="address-level2"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder={t.register.cityPlaceholder}
              className={`${inputClasses} bg-white`}
            />
          </div>

          <div>
            <label htmlFor="state" className={labelClasses}>
              {t.register.state}
            </label>
            <input
              id="state"
              type="text"
              autoComplete="address-level1"
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder={t.register.statePlaceholder}
              className={`${inputClasses} bg-white`}
            />
          </div>
        </div>

        {/* Email Address (Optional) */}
        <div>
          <label htmlFor="email" className={labelClasses}>
            {t.register.email}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t.register.emailPlaceholder}
            className={`${inputClasses} bg-white`}
            {...invalidProps('email')}
          />
          {fieldError('email')}
        </div>

        {/* On phones the action stays in reach at the bottom of the screen */}
        <div className="sticky bottom-0 z-10 -mx-5 mt-6 border-t border-sand bg-cream/95 px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
          <Button type="submit" fullWidth loading={loading} loadingText={t.register.submitting}>
            <span>{t.register.submitBtn}</span>
            <Check size={18} strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </form>
    </div>
  );
}

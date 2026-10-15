'use client';

import { useActionState, useState } from 'react';
import {
  AlertCircle,
  User,
  CheckCircle2,
  Info,
  MapPin,
  Check,
} from 'lucide-react';
import { createClientAction, ActionState } from '../actions';
import { normalizePhoneNumber, sanitizeIndianNationalPhone } from '../../../lib/phone';
import { GENDERS, MAX_AGE, RELATIONSHIP_STATUSES } from '../../../lib/options';
import {
  Button,
  ButtonLink,
  Card,
  Notice,
  helpTextClasses,
  inputClasses,
  inputGroupClasses,
  labelClasses,
} from '../../../components/brand';

const requiredMark = (
  <span className="text-coral-deep" aria-hidden>
    *
  </span>
);

export function CreateClientForm() {
  const [state, formAction, isPending] = useActionState<ActionState | null, FormData>(
    createClientAction,
    null
  );

  const [rawPhone, setRawPhone] = useState('');
  const phoneValidation = normalizePhoneNumber(rawPhone);

  return (
    <form action={formAction} className="space-y-6">
      {state?.error && (
        <Notice
          variant="error"
          role="alert"
          icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
        >
          {state.error}
        </Notice>
      )}

      {/* Basic Demographics Section */}
      <Card className="p-5 sm:p-6">
        <h2 className="text-[20px] font-semibold text-teal mb-4 flex items-center gap-2">
          <User size={18} strokeWidth={2} aria-hidden />
          <span>Client details</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Full Name */}
          <div className="sm:col-span-2">
            <label htmlFor="fullName" className={labelClasses}>
              Full name {requiredMark}
            </label>
            <input
              id="fullName"
              name="fullName"
              type="text"
              required
              placeholder="e.g. Ananya Sharma"
              className={inputClasses}
            />
          </div>

          {/* Mobile Phone */}
          <div className="sm:col-span-2">
            <label htmlFor="phone-input" className={labelClasses}>
              Mobile phone (for OTP login) {requiredMark}
            </label>
            <div className={inputGroupClasses}>
              <span className="text-ink-soft font-mono text-[16px] font-medium select-none shrink-0 pr-2">
                +91
              </span>
              <input
                id="phone-input"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                maxLength={10}
                value={rawPhone}
                onChange={(e) => setRawPhone(sanitizeIndianNationalPhone(e.target.value))}
                placeholder="98765 43210"
                className="no-inner-outline flex-1 min-h-[46px] bg-transparent font-mono text-[16px] text-ink placeholder:font-body placeholder:text-ink-muted border-none tracking-wider"
              />
            </div>
            {/* Hidden input ensures standard E.164 (+91XXXXXXXXXX) is submitted to server action */}
            <input
              type="hidden"
              name="phone"
              value={phoneValidation.valid ? phoneValidation.normalized : (rawPhone ? `+91${rawPhone}` : '')}
            />
            {rawPhone && (
              <p
                className={`text-[13px] mt-1.5 flex items-center gap-1 ${
                  phoneValidation.valid ? 'text-teal' : 'text-coral-deep'
                }`}
              >
                {phoneValidation.valid ? (
                  <>
                    <CheckCircle2 size={14} strokeWidth={2} aria-hidden />
                    <span>Saved as: {phoneValidation.formatted}</span>
                  </>
                ) : (
                  <>
                    <Info size={14} strokeWidth={2} aria-hidden />
                    <span>{phoneValidation.error}</span>
                  </>
                )}
              </p>
            )}
            <p className={helpTextClasses}>
              Enter the 10-digit number without the country code. It is stored as{' '}
              <span className="font-mono text-ink-soft">+91XXXXXXXXXX</span> for client OTP login.
            </p>
          </div>

          {/* Gender */}
          <div>
            <label htmlFor="gender" className={labelClasses}>
              Gender {requiredMark}
            </label>
            <select
              id="gender"
              name="gender"
              required
              defaultValue=""
              className={inputClasses}
            >
              <option value="" disabled>
                Choose one
              </option>
              {GENDERS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>

          {/* Age */}
          <div>
            <label htmlFor="age" className={labelClasses}>
              Age (years) {requiredMark}
            </label>
            <input
              id="age"
              name="age"
              type="number"
              min={1}
              max={MAX_AGE}
              step={1}
              required
              className={inputClasses}
            />
            <p className={helpTextClasses}>Clients must be 18 or older.</p>
          </div>

          {/* Relationship status (question I3) */}
          <div className="sm:col-span-2">
            <label htmlFor="maritalStatus" className={labelClasses}>
              Relationship status {requiredMark}
            </label>
            <select
              id="maritalStatus"
              name="maritalStatus"
              required
              defaultValue=""
              className={inputClasses}
            >
              <option value="" disabled>
                Choose one
              </option>
              {RELATIONSHIP_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {/* Optional Contact & Location Details */}
      <Card className="p-5 sm:p-6">
        <h2 className="text-[20px] font-semibold text-teal mb-4 flex items-center gap-2">
          <MapPin size={18} strokeWidth={2} aria-hidden />
          <span>Location &amp; contact (optional)</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* City */}
          <div>
            <label htmlFor="city" className={labelClasses}>
              City
            </label>
            <input
              id="city"
              name="city"
              type="text"
              placeholder="e.g. New Delhi"
              className={inputClasses}
            />
          </div>

          {/* State */}
          <div>
            <label htmlFor="state" className={labelClasses}>
              State
            </label>
            <input
              id="state"
              name="state"
              type="text"
              placeholder="e.g. Delhi / Haryana"
              className={inputClasses}
            />
          </div>

          {/* Email */}
          <div className="sm:col-span-2">
            <label htmlFor="email" className={labelClasses}>
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              placeholder="client@example.com"
              className={inputClasses}
            />
          </div>
        </div>
      </Card>

      {/* Form Submission Actions */}
      <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
        <ButtonLink href="/clients" variant="secondary">
          Cancel
        </ButtonLink>

        <Button
          type="submit"
          loading={isPending}
          loadingText="Creating record..."
          disabled={!phoneValidation.valid}
        >
          <Check size={18} strokeWidth={2} aria-hidden />
          <span>Create client record</span>
        </Button>
      </div>
    </form>
  );
}

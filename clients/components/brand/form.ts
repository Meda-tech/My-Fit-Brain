// Shared form-field styling: 8px inputs, sand border, teal border + coral focus ring on focus.
export const inputClasses =
  'w-full min-h-12 px-3.5 rounded-input border border-sand bg-white text-[16px] text-ink ' +
  'placeholder:text-ink-muted focus:border-teal focus:outline-2 focus:outline-offset-2 focus:outline-coral ' +
  'transition-colors';

// For a wrapper that holds a prefix (e.g. +91) and a borderless input.
export const inputGroupClasses =
  'flex items-center min-h-12 px-3.5 rounded-input border border-sand bg-white transition-colors ' +
  'focus-within:border-teal focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral';

export const labelClasses = 'block text-[14px] font-medium text-ink-soft mb-1.5';

export const helpTextClasses = 'text-[13px] text-ink-muted mt-1.5';

/**
 * Phone number normalization and validation utility.
 * Standardizes numbers to E.164 format (+91XXXXXXXXXX for India by default).
 */

export interface PhoneValidationResult {
  valid: boolean;
  normalized: string;
  formatted: string;
  error?: string;
}

export function normalizePhoneNumber(rawPhone: string): PhoneValidationResult {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, normalized: '', formatted: '', error: 'Mobile number is required' };
  }

  // Remove spaces, hyphens, parentheses, and dots
  const cleaned = rawPhone.trim().replace(/[\s\-\(\)\.]/g, '');

  if (cleaned.length === 0) {
    return { valid: false, normalized: '', formatted: '', error: 'Mobile number is required' };
  }

  let normalized = cleaned;

  // If starts with +, validate international E.164 format
  if (normalized.startsWith('+')) {
    const digitsOnly = normalized.slice(1);
    if (!/^\d{10,15}$/.test(digitsOnly)) {
      return {
        valid: false,
        normalized: '',
        formatted: rawPhone,
        error: 'Please enter a valid international mobile number (10 to 15 digits)',
      };
    }
    return {
      valid: true,
      normalized,
      formatted: formatDisplayPhone(normalized),
    };
  }

  // If starts with 00 (common international dialling prefix)
  if (normalized.startsWith('00')) {
    normalized = '+' + normalized.slice(2);
    const digitsOnly = normalized.slice(1);
    if (!/^\d{10,15}$/.test(digitsOnly)) {
      return {
        valid: false,
        normalized: '',
        formatted: rawPhone,
        error: 'Please enter a valid mobile number',
      };
    }
    return {
      valid: true,
      normalized,
      formatted: formatDisplayPhone(normalized),
    };
  }

  // If starts with 0 and followed by 10 digits (domestic Indian STD style)
  if (normalized.startsWith('0') && normalized.length === 11) {
    normalized = normalized.slice(1);
  }

  // If 10 digits, assume standard Indian mobile (+91)
  if (/^\d{10}$/.test(normalized)) {
    // Indian mobile numbers typically start with 6, 7, 8, 9
    const firstDigit = normalized[0];
    if (!['6', '7', '8', '9'].includes(firstDigit)) {
      return {
        valid: false,
        normalized: '',
        formatted: rawPhone,
        error: 'Indian mobile numbers must start with 6, 7, 8, or 9',
      };
    }
    const finalE164 = `+91${normalized}`;
    return {
      valid: true,
      normalized: finalE164,
      formatted: formatDisplayPhone(finalE164),
    };
  }

  // If 12 digits and starts with 91
  if (normalized.startsWith('91') && normalized.length === 12) {
    const mobileDigits = normalized.slice(2);
    if (['6', '7', '8', '9'].includes(mobileDigits[0])) {
      const finalE164 = `+${normalized}`;
      return {
        valid: true,
        normalized: finalE164,
        formatted: formatDisplayPhone(finalE164),
      };
    }
  }

  return {
    valid: false,
    normalized: '',
    formatted: rawPhone,
    error: 'Please enter a valid 10-digit mobile number',
  };
}

export function formatDisplayPhone(e164: string): string {
  if (e164.startsWith('+91') && e164.length === 13) {
    return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
  }
  return e164;
}

export function maskPhoneNumber(phone: string): string {
  if (!phone) return '';
  if (phone.length <= 4) return '****';
  const lastFour = phone.slice(-4);
  const prefix = phone.startsWith('+91') ? '+91 ' : '';
  return `${prefix}******${lastFour}`;
}

/**
 * Sanitizes phone input for 10-digit Indian mobile numbers without country code.
 * Strips leading +91, 91, or 0 if pasted, and limits input to max 10 numeric digits.
 */
export function sanitizeIndianNationalPhone(input: string): string {
  if (!input || typeof input !== 'string') return '';
  let cleaned = input.trim();

  // If user pasted something starting with +91 or +
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // Strip all non-digit characters
  let digits = cleaned.replace(/\D/g, '');

  // If user pasted 12 digits starting with 91 (e.g. 919876543210)
  if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  }
  // If user pasted 11 digits starting with 0 (e.g. 09876543210)
  else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Restrict to max 10 digits
  return digits.slice(0, 10);
}


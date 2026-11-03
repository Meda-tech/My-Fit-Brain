// Rules for offline payments (UPI to our number, bank transfer, other), recorded by staff on a client's
// profile with a payment screenshot or PDF as proof. No Next.js, database or Google imports, so the
// checks are unit-tested on their own (admin/test/offline-payments.test.ts).

/**
 * ₹3,500 per assessment, the same fixed price as online (clients/lib/payments/service.ts
 * ASSESSMENT_PRICE_PAISE; a test keeps the two equal). No discounts on offline payments.
 */
export const ASSESSMENT_PRICE_PAISE = 350_000;

export const OFFLINE_METHODS = ['upi', 'bank_transfer', 'other'] as const;
export type OfflineMethod = (typeof OFFLINE_METHODS)[number];

export const OFFLINE_METHOD_LABELS: Record<OfflineMethod, string> = {
  upi: 'UPI',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

export const REFERENCE_HINTS: Record<OfflineMethod, string> = {
  upi: 'UPI transaction ID',
  bank_transfer: 'Bank UTR number',
  other: 'Reference',
};

export const PROOF_MAX_BYTES = 4 * 1024 * 1024;
export const REFERENCE_MAX_LENGTH = 100;
export const NOTE_MAX_LENGTH = 500;
export const CANCEL_REASON_MIN_LENGTH = 3;
export const CANCEL_REASON_MAX_LENGTH = 500;
/** How far back a payment date may go. */
export const PAID_DATE_MAX_DAYS_BACK = 365;

export type ProofType = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
export const PROOF_ACCEPT = '.jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf';

const EXTENSIONS: Record<ProofType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/**
 * The proof's real type from its first bytes (never from the name or the browser's claim), or null
 * when it is not a JPG, PNG, WebP or PDF.
 */
export function detectProofType(bytes: Uint8Array): ProofType | null {
  const starts = (sig: number[], at = 0) => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'; // %PDF-
  return null;
}

/** Plain-English problem with the proof file, or null when it can be uploaded. */
export function proofProblem(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) return 'Add the payment proof (screenshot or PDF).';
  if (bytes.length > PROOF_MAX_BYTES) return 'The proof is larger than 4 MB. Please upload a smaller file.';
  if (!detectProofType(bytes)) return 'The proof must be a JPG, PNG, WebP image or a PDF.';
  return null;
}

/** File name in Drive: payment ID + date. Never the client's name. */
export function proofFileName(paymentId: string, date: string, type: ProofType): string {
  return `${paymentId}_${date}.${EXTENSIONS[type]}`;
}

/** Today's date in India (YYYY-MM-DD). */
export function indiaToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function isRealDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/**
 * The paid_at timestamp for a date paid (India): today → now; an earlier day → noon India time that
 * day (the time is not known). Not in the future, not more than a year back.
 */
export function paidAtFor(date: string, now = new Date()): { ok: true; paidAt: string } | { ok: false; error: string } {
  if (!isRealDate(date)) return { ok: false, error: 'Enter the date the payment was made.' };
  const today = indiaToday(now);
  if (date > today) return { ok: false, error: 'The payment date cannot be in the future.' };
  if (date === today) return { ok: true, paidAt: now.toISOString() };
  const paidAt = new Date(`${date}T12:00:00+05:30`);
  if (now.getTime() - paidAt.getTime() > PAID_DATE_MAX_DAYS_BACK * 86_400_000) {
    return { ok: false, error: 'The payment date is more than a year ago.' };
  }
  return { ok: true, paidAt: paidAt.toISOString() };
}

/** Trimmed reference with inner whitespace collapsed (what is stored and compared). */
export function cleanReference(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export interface OfflinePaymentInput {
  code: string;
  method: OfflineMethod;
  reference: string;
  note: string | null;
  paidAt: string;
}

/** Checks the typed fields of the form; the proof file is checked with proofProblem(). */
export function parseOfflinePayment(
  fields: { code: unknown; method: unknown; paidOn: unknown; reference: unknown; note: unknown },
  now = new Date()
): { ok: true; value: OfflinePaymentInput } | { ok: false; error: string } {
  const code = typeof fields.code === 'string' ? fields.code.trim() : '';
  if (!code) return { ok: false, error: 'Choose the assessment.' };
  const method = fields.method;
  if (typeof method !== 'string' || !(OFFLINE_METHODS as readonly string[]).includes(method)) {
    return { ok: false, error: 'Choose how the client paid.' };
  }
  const paid = paidAtFor(typeof fields.paidOn === 'string' ? fields.paidOn : '', now);
  if (!paid.ok) return paid;
  const reference = cleanReference(typeof fields.reference === 'string' ? fields.reference : '');
  if (!reference) return { ok: false, error: 'Enter the payment reference (UPI transaction ID, bank UTR or other).' };
  if (reference.length > REFERENCE_MAX_LENGTH) return { ok: false, error: `The reference can be at most ${REFERENCE_MAX_LENGTH} characters.` };
  const note = typeof fields.note === 'string' ? fields.note.trim() : '';
  if (note.length > NOTE_MAX_LENGTH) return { ok: false, error: `The note can be at most ${NOTE_MAX_LENGTH} characters.` };
  return { ok: true, value: { code, method: method as OfflineMethod, reference, note: note || null, paidAt: paid.paidAt } };
}

/** The cancel reason, trimmed, or an error sentence. */
export function parseCancelReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < CANCEL_REASON_MIN_LENGTH) return { ok: false, error: 'Write why the payment is cancelled.' };
  if (reason.length > CANCEL_REASON_MAX_LENGTH) return { ok: false, error: `The reason can be at most ${CANCEL_REASON_MAX_LENGTH} characters.` };
  return { ok: true, reason };
}

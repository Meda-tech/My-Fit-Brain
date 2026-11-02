import { timingSafeEqual } from 'node:crypto';

// Token and query checks for the Google Sheets sync API. No Next.js or database imports, so the
// checks run before anything is read.

export const SYNC_TOKEN_LENGTH = 64;

/**
 * True only for `Authorization: Bearer <token>` matching GOOGLE_SHEETS_SYNC_TOKEN. A missing or
 * wrongly sized server token refuses everyone (fail closed).
 */
export function isAuthorized(header: string | null, expected: string | undefined = process.env.GOOGLE_SHEETS_SYNC_TOKEN): boolean {
  if (!expected || expected.length !== SYNC_TOKEN_LENGTH) {
    console.error(`GOOGLE_SHEETS_SYNC_TOKEN is not set or not ${SYNC_TOKEN_LENGTH} characters; the Sheets sync refuses every request.`);
    return false;
  }
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  if (!match || match[1].length !== SYNC_TOKEN_LENGTH) return false;
  const given = Buffer.from(match[1], 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// ISO 8601 date and time with an explicit zone: 2026-11-01T00:00:00Z or 2026-11-01T05:30:00+05:30.
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/** The instant as an ISO string (UTC), or null when the text is not a valid timestamp with a zone. */
export function parseTimestamp(text: string): string | null {
  const m = ISO_WITH_ZONE.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0'] = m;
  const day = new Date(Date.UTC(+y, +mo - 1, +d));
  // Reject dates that do not exist (2026-02-30) and out-of-range times.
  if (day.getUTCFullYear() !== +y || day.getUTCMonth() !== +mo - 1 || day.getUTCDate() !== +d) return null;
  if (+h > 23 || +mi > 59 || +s > 59) return null;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export type RangeResult = { ok: true; from?: string; to?: string } | { ok: false; error: string };

/** Reads `from` (inclusive) and `to` (exclusive); both optional. */
export function parseRange(params: URLSearchParams): RangeResult {
  const out: { from?: string; to?: string } = {};
  for (const key of ['from', 'to'] as const) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = parseTimestamp(raw.trim());
    if (!value) return { ok: false, error: `Invalid "${key}": use an ISO 8601 timestamp with a time zone, e.g. 2026-11-01T00:00:00Z.` };
    out[key] = value;
  }
  if (out.from && out.to && out.from > out.to) return { ok: false, error: '"from" must not be later than "to".' };
  return { ok: true, ...out };
}

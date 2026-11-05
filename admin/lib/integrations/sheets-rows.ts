// Rows of the Google Sheets payments feed. No Next.js or database imports, so the rules are tested alone.
//
// One row per real purchase. A try that was not paid (created / failed) is left out when the same
// number tried the same test again later: Arti fails twice and then pays → one row, Paid. A paid,
// refunded or cancelled purchase is always its own row. The left-out ids are sent as `removed`, so a
// sheet that only fetches changes can delete the rows it already has for them.

export interface Try {
  id: string;
  phone: string;
  test_code: string;
  status: string;
  created_at: string;
}

const UNPAID = new Set(['created', 'failed']);

/** Ids of unpaid tries followed by a later try (any result) for the same number and test. */
export function replacedTries(tries: Try[]): Set<string> {
  const latest = new Map<string, string>();
  for (const t of tries) {
    const key = `${t.phone}|${t.test_code}`;
    const seen = latest.get(key);
    if (!seen || t.created_at > seen) latest.set(key, t.created_at);
  }
  const out = new Set<string>();
  for (const t of tries) {
    if (UNPAID.has(t.status) && t.created_at < latest.get(`${t.phone}|${t.test_code}`)!) out.add(t.id);
  }
  return out;
}

/** India time as "YYYY-MM-DD HH:mm:ss" (Google Sheets reads it as a date and time). */
export function indiaTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/** The latest of the given timestamps (ISO strings; nulls ignored). */
export function latest(...times: (string | null | undefined)[]): string {
  return times.filter((t): t is string => !!t).reduce((a, b) => (new Date(b) > new Date(a) ? b : a));
}

/** Newest payment first (paid time, else the time of the try); same time → by id, so the order never changes. */
export function byPaymentTime<T extends { id: string; time: string }>(a: T, b: T): number {
  const d = new Date(b.time).getTime() - new Date(a.time).getTime();
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

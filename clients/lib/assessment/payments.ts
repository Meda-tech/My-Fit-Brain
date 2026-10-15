// Payments are stubbed until the live gateway task. The stub works only when PAYMENTS_MODE=stub and
// never on a Vercel production deployment (fail closed).

export type PaymentsMode = 'stub' | 'off';

export function paymentsMode(env: Record<string, string | undefined> = process.env): PaymentsMode {
  if (env.VERCEL_ENV === 'production') return 'off';
  return env.PAYMENTS_MODE === 'stub' ? 'stub' : 'off';
}

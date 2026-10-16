export function formatAmount(paise: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100);
}

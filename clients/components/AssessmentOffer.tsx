import { Check } from 'lucide-react';
import { Pill, cn } from './brand';

/** The price with the regular price struck through (payment step and the pricing page only). */
export function PriceTag({
  price,
  regular,
  regularLabel,
  offerLabel,
  className,
}: {
  price: string;
  regular: string;
  regularLabel: string;
  offerLabel: string;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1', className)}>
      <span className="font-heading text-[34px] font-semibold leading-none text-ink">{price}</span>
      <s className="text-[18px] text-ink-muted">
        <span className="sr-only">{regularLabel}: </span>
        {regular}
      </s>
      <Pill>{offerLabel}</Pill>
    </div>
  );
}

/** What each assessment includes, as a checked list. */
export function FeatureList({ title, items, className }: { title: string; items: readonly string[]; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <ul className="mt-2 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-[15px] leading-6 text-ink-soft">
            <Check size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-teal" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

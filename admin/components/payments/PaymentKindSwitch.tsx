import Link from 'next/link';
import { cn } from '../brand';

// Payments has two lists: the ₹3,500 assessment payments and the package payments.
export function PaymentKindSwitch({ current }: { current: 'assessment' | 'package' }) {
  const items = [
    { key: 'assessment', href: '/payments', label: 'Assessment payments' },
    { key: 'package', href: '/payments/packages', label: 'Package payments' },
  ] as const;
  return (
    <nav aria-label="Payment type" className="mb-5 flex w-full gap-1 rounded-full border border-sand bg-white p-1 sm:w-fit">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === current ? 'page' : undefined}
          className={cn(
            'flex min-h-10 flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 text-[14px] font-semibold sm:flex-none',
            i.key === current ? 'bg-teal text-white' : 'text-ink-soft hover:bg-mist hover:text-teal'
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

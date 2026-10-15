import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  back?: { href: string; label: string };
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, eyebrow, back, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 sm:mb-8">
      {back && (
        <Link
          href={back.href}
          className="mb-2 inline-flex min-h-[44px] items-center gap-1.5 text-[14px] font-medium text-teal hover:underline"
        >
          <ArrowLeft size={16} strokeWidth={2} aria-hidden />
          <span>{back.label}</span>
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <div className="mb-2 flex flex-wrap items-center gap-2">{eyebrow}</div>}
          <h1 className="m-0 break-words text-[28px] font-semibold leading-[1.2] text-teal sm:text-[34px]">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-[640px] text-[16px] leading-[24px] text-ink-soft">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </div>
  );
}

import Link from 'next/link';
import { POLICY_LINKS } from '../../lib/legal';
import { cn } from './cn';

interface FooterProps {
  tone?: 'light' | 'dark';
  /** Top border on the light tone. */
  bordered?: boolean;
  className?: string;
}

export function Footer({ tone = 'light', bordered = true, className }: FooterProps) {
  return (
    <footer
      lang="en"
      className={cn(
        'px-4 py-5 text-center text-[13px] leading-5',
        tone === 'dark' ? 'bg-night text-white' : 'text-ink-muted',
        tone === 'light' && bordered && 'border-t border-sand',
        className
      )}
    >
      <nav aria-label="Policies" className="flex flex-wrap justify-center gap-x-5 gap-y-1">
        {POLICY_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              'inline-flex min-h-8 items-center font-medium underline decoration-dotted decoration-1 underline-offset-4',
              'transition-colors hover:decoration-solid',
              tone === 'dark' ? 'text-mist hover:text-white' : 'text-teal hover:text-night'
            )}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <p
        className={cn(
          'mx-auto mt-3 max-w-120 border-t pt-3 text-[12px]',
          tone === 'dark' ? 'border-white/15 text-mist' : 'border-sand text-ink-muted'
        )}
      >
        Space to speak. · My Fit Brain, a unit of MeDa Partners Pvt Ltd
      </p>
    </footer>
  );
}

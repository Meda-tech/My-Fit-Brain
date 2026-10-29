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
      <nav aria-label="Policies" className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
        {POLICY_LINKS.map((link) => (
          <Link key={link.href} href={link.href} className="underline-offset-2 hover:underline">
            {link.label}
          </Link>
        ))}
      </nav>
      Space to speak. · My Fit Brain, a unit of MeDa Partners Pvt Ltd
    </footer>
  );
}

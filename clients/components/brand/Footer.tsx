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
      <nav aria-label="Policies" className="flex flex-wrap justify-center gap-x-4 sm:gap-x-6">
        {POLICY_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            title={link.label}
            className="py-1 underline-offset-4 hover:underline"
          >
            {link.short}
          </Link>
        ))}
      </nav>
      <p className="mt-2 text-[12px] leading-4.5 opacity-80">
        <span className="block sm:inline">Space to speak.</span>
        <span className="hidden sm:inline"> · </span>
        <span className="block sm:inline">My Fit Brain</span>
      </p>
    </footer>
  );
}

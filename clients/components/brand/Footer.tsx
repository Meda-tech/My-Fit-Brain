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
      className={cn(
        'px-4 py-5 text-center text-[13px] leading-[20px]',
        tone === 'dark' ? 'bg-night text-white' : 'text-ink-muted',
        tone === 'light' && bordered && 'border-t border-sand',
        className
      )}
    >
      Space to speak. · My Fit Brain, a unit of MeDa Partners Pvt Ltd
    </footer>
  );
}

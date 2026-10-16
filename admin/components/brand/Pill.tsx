import { cn } from './cn';

export type PillTone = 'mist' | 'quiet';

const TONE_CLASSES: Record<PillTone, string> = {
  mist: 'bg-mist text-teal',
  quiet: 'bg-cream text-ink-soft border border-sand',
};

interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

export function Pill({ tone = 'mist', className, ...rest }: PillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5',
        'text-[12px] font-semibold uppercase tracking-[0.06em] leading-4.5',
        TONE_CLASSES[tone],
        className
      )}
      {...rest}
    />
  );
}

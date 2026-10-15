import { cn } from './cn';

export type NoticeVariant = 'info' | 'medical' | 'error';

const VARIANT_CLASSES: Record<NoticeVariant, string> = {
  info: 'bg-mist border-l-4 border-l-teal',
  medical: 'bg-cream border border-sand border-l-4 border-l-teal',
  // Calm form/action errors: no red, no warning triangles.
  error: 'bg-white border border-sand border-l-4 border-l-coral-deep',
};

interface NoticeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: NoticeVariant;
  icon?: React.ReactNode;
  title?: React.ReactNode;
}

export function Notice({
  variant = 'info',
  icon,
  title,
  className,
  children,
  ...rest
}: NoticeProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-input p-4 text-[14px] leading-[22px] text-ink-soft',
        VARIANT_CLASSES[variant],
        className
      )}
      {...rest}
    >
      {icon && <span className="mt-0.5 shrink-0 text-teal">{icon}</span>}
      <div className="min-w-0 flex-1">
        {title && <p className="mb-1 font-semibold text-ink">{title}</p>}
        {children}
      </div>
    </div>
  );
}

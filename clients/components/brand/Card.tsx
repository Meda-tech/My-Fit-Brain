import { cn } from './cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  shadow?: boolean;
}

export function Card({ shadow = true, className, ...rest }: CardProps) {
  return (
    <div
      className={cn('bg-white border border-sand rounded-card', shadow && 'shadow-card', className)}
      {...rest}
    />
  );
}

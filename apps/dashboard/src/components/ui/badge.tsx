import clsx from 'clsx';

type BadgeVariant = 'default' | 'green' | 'yellow' | 'red' | 'primary' | 'muted';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-surface-lighter text-text-secondary',
  green: 'bg-green/15 text-green',
  yellow: 'bg-yellow/15 text-yellow',
  red: 'bg-red/15 text-red',
  primary: 'bg-primary/15 text-primary-light',
  muted: 'bg-surface-lighter text-text-muted',
};

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

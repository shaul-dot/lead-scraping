'use client';

import clsx from 'clsx';
import { AlertTriangle, AlertCircle, Info, CheckCircle, X } from 'lucide-react';

type Severity = 'critical' | 'warning' | 'info' | 'success';

interface AlertCardProps {
  severity: Severity;
  title: string;
  description: string;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  timestamp?: string;
}

const severityConfig: Record<Severity, { icon: React.ReactNode; border: string; iconColor: string }> = {
  critical: {
    icon: <AlertCircle className="h-5 w-5" />,
    border: 'border-l-red',
    iconColor: 'text-red',
  },
  warning: {
    icon: <AlertTriangle className="h-5 w-5" />,
    border: 'border-l-yellow',
    iconColor: 'text-yellow',
  },
  info: {
    icon: <Info className="h-5 w-5" />,
    border: 'border-l-primary',
    iconColor: 'text-primary-light',
  },
  success: {
    icon: <CheckCircle className="h-5 w-5" />,
    border: 'border-l-green',
    iconColor: 'text-green',
  },
};

export function AlertCard({ severity, title, description, action, onAction, onDismiss, timestamp }: AlertCardProps) {
  const config = severityConfig[severity];

  return (
    <div
      className={clsx(
        'rounded-xl border border-border border-l-4 bg-surface-light p-4 transition-colors duration-200',
        config.border
      )}
    >
      <div className="flex items-start gap-3">
        <span className={clsx('mt-0.5 shrink-0', config.iconColor)}>{config.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-text-primary">{title}</p>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="shrink-0 rounded-lg p-1 text-text-muted transition-colors hover:bg-surface-lighter hover:text-text-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-text-secondary">{description}</p>
          <div className="mt-3 flex items-center gap-3">
            {action && onAction && (
              <button
                onClick={onAction}
                className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary-light transition-colors hover:bg-primary/25 min-h-[32px]"
              >
                {action}
              </button>
            )}
            {timestamp && <span className="text-xs text-text-muted">{timestamp}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

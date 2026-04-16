'use client';

import clsx from 'clsx';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: number; label?: string };
  icon?: React.ReactNode;
  className?: string;
}

export function StatCard({ label, value, subtitle, trend, icon, className }: StatCardProps) {
  const trendDirection = trend ? (trend.value > 0 ? 'up' : trend.value < 0 ? 'down' : 'flat') : null;

  return (
    <div
      className={clsx(
        'rounded-xl border border-border bg-surface-light p-5 transition-colors duration-200',
        className
      )}
    >
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        {icon && <span className="text-text-muted">{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-text-primary">{value}</p>
      <div className="mt-2 flex items-center gap-2">
        {trend && (
          <span
            className={clsx(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              trendDirection === 'up' && 'text-green',
              trendDirection === 'down' && 'text-red',
              trendDirection === 'flat' && 'text-text-muted'
            )}
          >
            {trendDirection === 'up' && <TrendingUp className="h-3 w-3" />}
            {trendDirection === 'down' && <TrendingDown className="h-3 w-3" />}
            {trendDirection === 'flat' && <Minus className="h-3 w-3" />}
            {trend.value > 0 ? '+' : ''}{trend.value}%
            {trend.label && <span className="ml-1 text-text-muted">{trend.label}</span>}
          </span>
        )}
        {subtitle && <span className="text-xs text-text-muted">{subtitle}</span>}
      </div>
    </div>
  );
}

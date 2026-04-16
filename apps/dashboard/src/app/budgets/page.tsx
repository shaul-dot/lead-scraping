'use client';

import { Badge } from '@/components/ui/badge';
import { Bot, DollarSign, Clock, TrendingDown } from 'lucide-react';
import clsx from 'clsx';
import { useBudgets } from '@/lib/hooks';

interface BudgetProvider {
  name: string;
  used: number;
  cap: number;
  remaining: number;
  daysUntilReset: number;
  currency: string;
}

function getBudgetColor(percent: number): string {
  if (percent > 95) return 'red';
  if (percent > 80) return 'yellow';
  return 'green';
}

export default function BudgetsPage() {
  const budgetsQuery = useBudgets();

  if (budgetsQuery.isLoading) return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if (budgetsQuery.isError) return <div className="p-8 text-center text-red-400">Failed to load data</div>;

  const budgetsData = budgetsQuery.data as any;
  const providers: BudgetProvider[] = budgetsData?.providers ?? [];
  const recommendations: { title: string; reasoning: string }[] = budgetsData?.recommendations ?? [];

  if (!providers.length) return <div className="p-8 text-center text-gray-400">No data yet</div>;

  const totalUsed = providers.reduce((s, p) => s + p.used, 0);
  const totalCap = providers.reduce((s, p) => s + p.cap, 0);

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Budgets</h1>
        <div className="text-right">
          <p className="text-sm text-text-muted">Total spend</p>
          <p className="text-lg font-bold">
            ${totalUsed.toLocaleString()}
            <span className="text-sm text-text-muted"> / ${totalCap.toLocaleString()}</span>
          </p>
        </div>
      </div>

      {/* Overview bar */}
      <div className="rounded-xl border border-border bg-surface-light p-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-text-muted">Overall budget utilization</span>
          <span className={clsx('font-medium', `text-${getBudgetColor((totalUsed / totalCap) * 100)}`)}>
            {Math.round((totalUsed / totalCap) * 100)}%
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-surface-lighter">
          <div
            className={clsx('h-full rounded-full transition-all duration-500', `bg-${getBudgetColor((totalUsed / totalCap) * 100)}`)}
            style={{ width: `${(totalUsed / totalCap) * 100}%` }}
          />
        </div>
      </div>

      {/* Provider cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => {
          const percent = (provider.used / provider.cap) * 100;
          const color = getBudgetColor(percent);

          return (
            <div
              key={provider.name}
              className={clsx(
                'rounded-xl border bg-surface-light p-5 space-y-4 transition-colors duration-200',
                color === 'red' ? 'border-red/30' : color === 'yellow' ? 'border-yellow/30' : 'border-border'
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-text-muted" />
                  <span className="font-medium text-text-primary">{provider.name}</span>
                </div>
                <Badge variant={color === 'red' ? 'red' : color === 'yellow' ? 'yellow' : 'green'}>
                  {Math.round(percent)}%
                </Badge>
              </div>

              {/* Progress bar */}
              <div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-lighter">
                  <div
                    className={clsx('h-full rounded-full transition-all duration-500', `bg-${color}`)}
                    style={{ width: `${Math.min(100, percent)}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-text-secondary">
                    {provider.currency}{provider.used} used
                  </span>
                  <span className="text-text-muted">
                    {provider.currency}{provider.cap} cap
                  </span>
                </div>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface p-2.5">
                  <span className="text-text-muted">Remaining</span>
                  <p className={clsx('mt-0.5 font-semibold', `text-${color}`)}>
                    {provider.currency}{provider.remaining}
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-2.5">
                  <span className="text-text-muted">Reset in</span>
                  <p className="mt-0.5 font-semibold text-text-primary flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {provider.daysUntilReset}d
                  </p>
                </div>
              </div>

              {color === 'red' && (
                <div className="flex items-center gap-2 rounded-lg bg-red/10 p-2.5 text-xs text-red">
                  <TrendingDown className="h-3.5 w-3.5 shrink-0" />
                  <span>Budget nearly exhausted — consider reducing daily spend</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Paperclip recommendations */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <Bot className="h-4 w-4 text-primary-light" />
          <h2 className="text-sm font-medium text-text-secondary">Paperclip Budget Recommendations</h2>
        </div>
        <div className="space-y-3">
          {recommendations.map((rec, i) => (
            <div key={i} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface-light p-4">
              <div>
                <p className="text-sm font-medium text-text-primary">{rec.title}</p>
                <p className="mt-1 text-xs text-text-secondary">{rec.reasoning}</p>
              </div>
              <button className="shrink-0 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/20 transition-colors min-h-[32px]">
                Apply
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

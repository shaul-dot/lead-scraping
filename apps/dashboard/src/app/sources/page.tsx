'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Database,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import { useSources } from '@/lib/hooks';

interface Source {
  name: string;
  tier: string;
  yieldTrend: number[];
  errorRate: number;
  lastScrape: string;
  sessionsActive: number;
  sessionsTotal: number;
  tierHistory: { tier: string; date: string; reason: string }[];
}

const tierVariant: Record<string, 'green' | 'yellow' | 'red' | 'muted'> = {
  'Tier 1': 'green',
  'Tier 2': 'yellow',
  'Tier 3': 'red',
};

function MiniChart({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((val, i) => (
        <div
          key={i}
          className="w-2 rounded-sm bg-primary/60 transition-all duration-300"
          style={{ height: `${((val - min) / range) * 100}%`, minHeight: '2px' }}
        />
      ))}
    </div>
  );
}

export default function SourcesPage() {
  const sourcesQuery = useSources();
  const sources: Source[] = Array.isArray(sourcesQuery.data) ? sourcesQuery.data as Source[] : [];
  const [expandedHistory, setExpandedHistory] = useState<Set<string>>(new Set());

  function toggleHistory(name: string) {
    setExpandedHistory((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  if (sourcesQuery.isLoading) return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if (sourcesQuery.isError) return <div className="p-8 text-center text-red-400">Failed to load data</div>;
  if (!sources.length) return <div className="p-8 text-center text-gray-400">No data yet</div>;

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Sources</h1>
        <span className="text-sm text-text-muted">{sources.length} sources</span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((source) => {
          const lastVal = source.yieldTrend[source.yieldTrend.length - 1];
          const prevVal = source.yieldTrend[source.yieldTrend.length - 2];
          const trending = lastVal > prevVal ? 'up' : lastVal < prevVal ? 'down' : 'flat';
          const historyOpen = expandedHistory.has(source.name);
          const poolPercent = (source.sessionsActive / source.sessionsTotal) * 100;

          return (
            <div key={source.name} className="rounded-xl border border-border bg-surface-light p-5 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5 text-text-muted" />
                  <span className="font-medium text-text-primary">{source.name}</span>
                </div>
                <Badge variant={tierVariant[source.tier] || 'muted'}>{source.tier}</Badge>
              </div>

              {/* Yield trend chart */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-text-muted">7-day yield trend</span>
                  <span className={clsx('flex items-center gap-1 text-xs font-medium', trending === 'up' ? 'text-green' : trending === 'down' ? 'text-red' : 'text-text-muted')}>
                    {trending === 'up' ? <TrendingUp className="h-3 w-3" /> : trending === 'down' ? <TrendingDown className="h-3 w-3" /> : null}
                    {lastVal} leads/day
                  </span>
                </div>
                <MiniChart data={source.yieldTrend} />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-surface p-2.5">
                  <span className="text-text-muted">Error Rate</span>
                  <p className={clsx('mt-0.5 font-medium', source.errorRate > 5 ? 'text-red' : source.errorRate > 3 ? 'text-yellow' : 'text-green')}>
                    {source.errorRate}%
                  </p>
                </div>
                <div className="rounded-lg bg-surface p-2.5">
                  <span className="text-text-muted">Last Scrape</span>
                  <p className="mt-0.5 font-medium text-text-primary flex items-center gap-1">
                    <Clock className="h-3 w-3" /> {source.lastScrape}
                  </p>
                </div>
              </div>

              {/* Session pool */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-text-muted">Session Pool</span>
                  <span className={clsx('font-medium', poolPercent >= 60 ? 'text-green' : poolPercent >= 40 ? 'text-yellow' : 'text-red')}>
                    {source.sessionsActive}/{source.sessionsTotal} active
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-lighter">
                  <div
                    className={clsx('h-full rounded-full transition-all', poolPercent >= 60 ? 'bg-green' : poolPercent >= 40 ? 'bg-yellow' : 'bg-red')}
                    style={{ width: `${poolPercent}%` }}
                  />
                </div>
              </div>

              {/* Tier override */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Override tier</span>
                <select className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-secondary outline-none">
                  <option>Auto</option>
                  <option>Tier 1</option>
                  <option>Tier 2</option>
                  <option>Tier 3</option>
                </select>
              </div>

              {/* Tier switch history */}
              <button
                onClick={() => toggleHistory(source.name)}
                className="flex w-full items-center justify-between text-xs text-text-muted hover:text-text-secondary transition-colors"
              >
                <span>Tier history</span>
                <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', historyOpen && 'rotate-180')} />
              </button>
              {historyOpen && (
                <div className="space-y-1.5">
                  {source.tierHistory.map((entry, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg bg-surface p-2 text-xs">
                      {entry.tier === 'Tier 1' ? (
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green" />
                      ) : entry.tier === 'Tier 3' ? (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red" />
                      ) : (
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow" />
                      )}
                      <div>
                        <span className="font-medium text-text-primary">{entry.tier}</span>
                        <span className="text-text-muted"> — {entry.date}</span>
                        <p className="text-text-muted">{entry.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

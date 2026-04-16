'use client';

import { TrafficLight } from '@/components/ui/traffic-light';
import { StatCard } from '@/components/ui/stat-card';
import { AlertCard } from '@/components/ui/alert-card';
import { Badge } from '@/components/ui/badge';
import {
  Upload,
  Play,
  Pause,
  ListChecks,
  Bot,
  Facebook,
  Instagram,
  BarChart3,
} from 'lucide-react';
import { useHealth, useDailyStats, useAlerts } from '@/lib/hooks';

const channelIcons: Record<string, React.ReactNode> = {
  'Facebook Ads': <Facebook className="h-5 w-5" />,
  'Instagram': <Instagram className="h-5 w-5" />,
};

export default function HealthPage() {
  const health = useHealth();
  const stats = useDailyStats();
  const alertsQuery = useAlerts();

  if (health.isLoading || stats.isLoading || alertsQuery.isLoading)
    return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if (health.isError || stats.isError || alertsQuery.isError)
    return <div className="p-8 text-center text-red-400">Failed to load data</div>;

  const healthData = health.data as any;
  const statsData = stats.data as any;
  const alertsData = alertsQuery.data as any;

  const healthIndicators = healthData?.indicators ?? [];
  const channelStats = (statsData?.channels ?? []).map((ch: any) => ({
    ...ch,
    icon: channelIcons[ch.label] ?? null,
  }));
  const alerts = Array.isArray(alertsData) ? alertsData : [];
  const latestAction = healthData?.latestPaperclipAction;

  if (!healthIndicators.length && !channelStats.length && !alerts.length)
    return <div className="p-8 text-center text-gray-400">No data yet</div>;

  const total = channelStats.reduce((s: number, c: any) => s + (c.value ?? 0), 0);
  const totalTarget = channelStats.reduce((s: number, c: any) => s + (c.target ?? 0), 0);

  return (
    <div className="space-y-6 pb-20 md:pb-6">
      {/* Traffic lights */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">System Health</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {healthIndicators.map((h) => (
            <TrafficLight key={h.label} {...h} />
          ))}
        </div>
      </section>

      {/* Today's numbers */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Today&apos;s Numbers</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {channelStats.map((ch) => (
            <div
              key={ch.label}
              className="rounded-xl border border-border bg-surface-light p-5 transition-colors duration-200"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-text-secondary">
                  {ch.icon}
                  <span className="text-sm font-medium">{ch.label}</span>
                </div>
                <Badge variant={ch.value >= ch.target ? 'green' : 'yellow'}>
                  {Math.round((ch.value / ch.target) * 100)}%
                </Badge>
              </div>
              <p className="mt-3 text-3xl font-bold tracking-tight">
                {ch.value}
                <span className="text-lg text-text-muted"> / {ch.target}</span>
              </p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-lighter">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, (ch.value / ch.target) * 100)}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-text-muted">Cost</span>
                <span className="text-right text-text-secondary">{ch.cost}</span>
                <span className="text-text-muted">CPL</span>
                <span className="text-right text-text-secondary">{ch.cpl}</span>
                <span className="text-text-muted">Replies</span>
                <span className="text-right text-text-secondary">{ch.replies}</span>
                <span className="text-text-muted">Booked</span>
                <span className="text-right text-text-secondary">{ch.booked}</span>
              </div>
            </div>
          ))}

          <StatCard
            label="Total Uploaded"
            value={total}
            subtitle={`of ${totalTarget} target`}
            trend={{ value: 12, label: 'vs yesterday' }}
            icon={<BarChart3 className="h-5 w-5" />}
          />
        </div>
      </section>

      {/* Paperclip's latest action */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Paperclip&apos;s Latest Action</h2>
        <div className="rounded-xl border border-primary/20 bg-surface-light p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
              <Bot className="h-5 w-5 text-primary-light" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {latestAction?.action ?? 'No recent action'}
                  </p>
                  {latestAction?.reasoning && (
                    <p className="mt-1 text-xs text-text-secondary">
                      Reasoning: {latestAction.reasoning}
                    </p>
                  )}
                </div>
                <button className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-lighter hover:text-text-primary min-h-[32px]">
                  Override
                </button>
              </div>
              <p className="mt-2 text-xs text-text-muted">{latestAction?.timestamp ?? ''}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Active alerts */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Active Alerts</h2>
        <div className="space-y-3">
          {alerts.map((alert, i) => (
            <AlertCard key={i} {...alert} onAction={() => {}} onDismiss={() => {}} />
          ))}
        </div>
      </section>

      {/* Quick actions */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-text-secondary">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Import CSV', icon: Upload },
            { label: 'Run Pipeline', icon: Play },
            { label: 'Pause All', icon: Pause },
            { label: 'Paperclip Queue', icon: ListChecks },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.label}
                className="flex items-center gap-2 rounded-xl border border-border bg-surface-light px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors duration-200 hover:bg-surface-lighter hover:text-text-primary min-h-[44px]"
              >
                <Icon className="h-4 w-4" />
                {action.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';

export interface TimelineEvent {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  timestamp: string;
  status?: 'completed' | 'active' | 'pending';
  icon?: React.ReactNode;
}

interface TimelineProps {
  events: TimelineEvent[];
}

export function Timeline({ events }: TimelineProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="relative space-y-0">
      {events.map((event, i) => {
        const isExpanded = expanded.has(event.id);
        const isLast = i === events.length - 1;
        return (
          <div key={event.id} className="relative flex gap-4 pb-6">
            {!isLast && (
              <div className="absolute left-[15px] top-8 h-[calc(100%-16px)] w-px bg-border" />
            )}
            <div className="relative z-[1] flex h-8 w-8 shrink-0 items-center justify-center">
              {event.icon ? (
                <span
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-full',
                    event.status === 'completed' && 'bg-green/15 text-green',
                    event.status === 'active' && 'bg-primary/15 text-primary-light',
                    event.status === 'pending' && 'bg-surface-lighter text-text-muted'
                  )}
                >
                  {event.icon}
                </span>
              ) : (
                <span
                  className={clsx(
                    'h-3 w-3 rounded-full ring-4 ring-surface',
                    event.status === 'completed' && 'bg-green',
                    event.status === 'active' && 'bg-primary',
                    event.status === 'pending' && 'bg-surface-lighter'
                  )}
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <button
                onClick={() => event.detail && toggle(event.id)}
                className={clsx(
                  'flex w-full items-start justify-between text-left',
                  event.detail && 'cursor-pointer'
                )}
              >
                <div>
                  <p className="text-sm font-medium text-text-primary">{event.label}</p>
                  {event.description && (
                    <p className="mt-0.5 text-xs text-text-secondary">{event.description}</p>
                  )}
                  <p className="mt-1 text-xs text-text-muted">{event.timestamp}</p>
                </div>
                {event.detail && (
                  <ChevronDown
                    className={clsx(
                      'mt-1 h-4 w-4 shrink-0 text-text-muted transition-transform duration-200',
                      isExpanded && 'rotate-180'
                    )}
                  />
                )}
              </button>
              {isExpanded && event.detail && (
                <div className="mt-2 rounded-lg bg-surface p-3 text-xs text-text-secondary">
                  {event.detail}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

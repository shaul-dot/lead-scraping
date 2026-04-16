'use client';

import clsx from 'clsx';

type Status = 'green' | 'yellow' | 'red';

interface TrafficLightProps {
  status: Status;
  label: string;
  detail?: string;
  onClick?: () => void;
}

const statusColors: Record<Status, { bg: string; ring: string; pulse: string }> = {
  green: { bg: 'bg-green', ring: 'ring-green/30', pulse: 'bg-green/50' },
  yellow: { bg: 'bg-yellow', ring: 'ring-yellow/30', pulse: 'bg-yellow/50' },
  red: { bg: 'bg-red', ring: 'ring-red/30', pulse: 'bg-red/50' },
};

export function TrafficLight({ status, label, detail, onClick }: TrafficLightProps) {
  const colors = statusColors[status];

  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex items-center gap-3 rounded-xl bg-surface-light px-4 py-3',
        'border border-border transition-colors duration-200',
        'hover:bg-surface-lighter min-h-[44px] w-full text-left',
        onClick && 'cursor-pointer'
      )}
    >
      <span className="relative flex h-3.5 w-3.5 shrink-0">
        {status === 'red' && (
          <span className={clsx('absolute inset-0 animate-ping rounded-full', colors.pulse)} />
        )}
        <span className={clsx('relative inline-flex h-3.5 w-3.5 rounded-full ring-4', colors.bg, colors.ring)} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {detail && <p className="truncate text-xs text-text-muted">{detail}</p>}
      </div>
    </button>
  );
}

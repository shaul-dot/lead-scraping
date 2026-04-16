export type HealthStatus = 'green' | 'yellow' | 'red';

export interface TrafficLight {
  label: string;
  status: HealthStatus;
  detail: string;
  link: string;
}

export interface SourceDayStats {
  uploaded: number;
  target: number;
}

export interface TodayNumbers {
  facebook: SourceDayStats;
  instagram: SourceDayStats;
  total: SourceDayStats;
  costUsd: number;
  costPerLead: number;
  repliesToday: number;
  bookedToday: number;
}

export interface HealthOverview {
  pipeline: TrafficLight;
  budget: TrafficLight;
  deliverability: TrafficLight;
  paperclip: TrafficLight;
  todayNumbers: TodayNumbers;
}

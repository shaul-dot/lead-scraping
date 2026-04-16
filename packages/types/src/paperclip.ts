export type PaperclipActionCategory =
  | 'keyword_optimization'
  | 'alert_triage'
  | 'dlq_processing'
  | 'tier_switch_review'
  | 'reply_analysis'
  | 'daily_digest'
  | 'weekly_strategy'
  | 'session_reauth'
  | 'campaign_health'
  | 'budget_review'
  | 'personalization_ab_test';

export interface PaperclipDecision {
  action: string;
  reasoning: string;
  category: PaperclipActionCategory;
  confidence: number;
  requiresHumanApproval: boolean;
}

export interface DailyMetrics {
  leadsScraped: number;
  leadsEnriched: number;
  leadsPassedIcp: number;
  leadsValidated: number;
  leadsUploaded: number;
  leadsReplied: number;
  leadsBooked: number;
  totalCostUsd: number;
  costPerLead: number;
  bySource: Record<string, { scraped: number; uploaded: number; cost: number }>;
}

export interface DailyDigest {
  date: string;
  metrics: DailyMetrics;
  topWins: string[];
  topConcerns: string[];
  autonomousActions: string[];
  recommendations: string[];
  escalations: string[];
}

export interface WeeklyStrategy {
  weekOf: string;
  bookedLeadPatterns: {
    industry: string;
    geogrpahy: string;
    leadMagnetType: string;
    keyword: string;
  }[];
  keywordRecommendations: {
    add: string[];
    remove: string[];
    reasoning: string;
  };
  personalizationInsights: string[];
  budgetRecommendations: string[];
}

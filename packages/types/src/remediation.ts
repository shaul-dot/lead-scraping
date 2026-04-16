export type RemediationTrigger =
  | 'no_email_found'
  | 'session_challenge'
  | 'personalization_rejected'
  | 'instantly_campaign_missing'
  | 'instantly_upload_failed'
  | 'provider_budget_exhausted'
  | 'scraper_tier_degraded'
  | 'landing_page_unparseable'
  | 'reply_classification_low_confidence'
  | 'duplicate_with_richer_data'
  | 'wrong_person_reply';

export interface RemediationStrategy {
  name: string;
  handler: string;
  maxAttempts: number;
}

export interface RemediationEvent {
  leadId?: string;
  trigger: RemediationTrigger;
  context: Record<string, unknown>;
}

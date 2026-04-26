export interface BrightDataInstagramProfile {
  account: string;
  id: string;
  followers: number;
  posts_count: number;
  is_business_account: boolean;
  is_professional_account: boolean;
  is_verified: boolean;
  avg_engagement: number;
  external_url: string | null;
  biography: string | null;
  business_category_name: string | null;
  category_name: string | null;
  profile_image_link: string | null;
  profile_url: string;
  profile_name: string | null;
  full_name: string | null;
  highlights_count: number | null;
  highlights: any[] | null;
  is_private: boolean;
  bio_hashtags: string[] | null;
  url: string;
  is_joined_recently: boolean | null;
  has_channel: boolean | null;
  business_address: any | null;
  related_accounts: BrightDataRelatedAccount[] | null;
  email_address: string | null;
  external_url_title: string | null;
  pronouns: string | null;
  timestamp: string;
  input_url: string;
  error?: string;
  error_code?: string;
  warning?: string;
  warning_code?: string;
}

export interface BrightDataRelatedAccount {
  account: string;
  id: string | null;
  profile_url: string;
  profile_image_link: string | null;
  full_name: string | null;
  is_verified: boolean | null;
}

export interface BrightDataGoogleResult {
  url: string;
  rank: number;
  link: string;
  title: string;
  description: string | null;
}

export interface BrightDataSerpOrganicResult extends BrightDataGoogleResult {}

export interface BrightDataSerpRecord {
  url: string;
  keyword: string | null;
  general?: unknown;
  organic?: BrightDataSerpOrganicResult[] | null;
  people_also_ask?: unknown;
  related?: unknown;
  navigation?: unknown;
  local_pack?: unknown;
  pagination?: unknown;
  aio_text?: string | null;
  aio_citations?: unknown;
  page_html?: string | null;
  timestamp: string;
  input?: { url?: string } | null;
  country?: string | null;
  language?: string | null;
  index?: number | null;
}

export type BrightDataSnapshotStatus =
  | 'running'
  | 'ready'
  | 'failed'
  | 'collecting'
  | 'building';

export interface BrightDataSnapshotProgress {
  status: BrightDataSnapshotStatus;
  records_count?: number;
  errors?: number;
}

export class BrightDataError extends Error {
  constructor(message: string, public statusCode?: number, public body?: string) {
    super(message);
    this.name = 'BrightDataError';
  }
}


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
  query: string;
  url: string;
  title: string | null;
  description: string | null;
  rank: number;
  timestamp: string;
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


export type ExaSearchType =
  | 'enrichment'
  | 'personalization_context'
  | 'keyword_discovery'
  | 'icp_verification'
  | 'landing_page_analysis'
  | 'alt_contact_search';

export interface ExaSearchInput {
  query: string;
  searchType: ExaSearchType;
  numResults?: number;
  startPublishedDate?: string;
  category?: string;
}

export interface ExaSearchResult {
  title: string;
  url: string;
  text?: string;
  publishedDate?: string;
  author?: string;
  score: number;
}

export { BaseAdapter, type AdapterResult, type LeadInput } from './base';

export {
  getActiveFacebookAdapter,
  FacebookTier1Adapter,
  FacebookTier2Adapter,
  FacebookTier3Adapter,
  type RawFacebookAd,
} from './facebook/index';

export {
  getActiveInstagramAdapter,
  InstagramTier2Adapter,
  InstagramTier3Adapter,
  qualifyProfile,
  validateBioLink,
  extractCompanyName,
  type RawInstagramProfile,
  type IGQualificationResult,
} from './instagram/index';

export {
  evaluateSourceHealth,
  getNextTier,
  executeTierSwitch,
  type SourceHealthEvaluation,
} from './tier-switcher';

export {
  LandingPageFetcher,
  ExaLandingPageFetcher,
  CoachQualifier,
  QualifierError,
  type LandingPageFailure,
  type LandingPageResult,
  type LandingPageSuccess,
  type CoachQualifierOptions,
  type QualifierCategory,
  type QualifierConfidence,
  type QualifierInput,
  type QualifierMetadata,
  type QualifierOfferingType,
  type QualifierOutput,
} from './qualification/index';

export { BrightDataClient } from './brightdata/index';
export type {
  BrightDataInstagramProfile,
  BrightDataGoogleResult,
  BrightDataRelatedAccount,
} from './brightdata/index';

export { ApifyInstagramHashtagScraper, type ApifyHashtagScrapeResult } from './apify-instagram/hashtag-scraper';

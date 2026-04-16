export { BaseAdapter, type AdapterResult, type LeadInput } from './base.js';

export {
  getActiveFacebookAdapter,
  FacebookTier1Adapter,
  FacebookTier2Adapter,
  FacebookTier3Adapter,
  qualifyAd,
  type RawFacebookAd,
  type QualificationResult,
} from './facebook/index.js';

export {
  getActiveInstagramAdapter,
  InstagramTier2Adapter,
  InstagramTier3Adapter,
  qualifyProfile,
  validateBioLink,
  extractCompanyName,
  type RawInstagramProfile,
  type IGQualificationResult,
} from './instagram/index.js';

export {
  evaluateSourceHealth,
  getNextTier,
  executeTierSwitch,
  type SourceHealthEvaluation,
} from './tier-switcher.js';

import { prisma } from '@hyperscale/database';
import type { BaseAdapter } from '../base.js';
import { FacebookTier1Adapter } from './tier1.js';
import { FacebookTier2Adapter } from './tier2.js';
import { FacebookTier3Adapter } from './tier3.js';

export { FacebookTier1Adapter } from './tier1.js';
export { FacebookTier2Adapter } from './tier2.js';
export { FacebookTier3Adapter } from './tier3.js';
export { qualifyAd, type RawFacebookAd, type QualificationResult } from './qualify.js';

export async function getActiveFacebookAdapter(): Promise<BaseAdapter> {
  const config = await prisma.sourceConfig.findUnique({
    where: { source: 'FACEBOOK_ADS' },
  });

  switch (config?.activeTier) {
    case 'TIER_1_API':
      return new FacebookTier1Adapter();
    case 'TIER_3_INHOUSE':
      return new FacebookTier3Adapter();
    case 'TIER_2_MANAGED':
    default:
      return new FacebookTier2Adapter();
  }
}

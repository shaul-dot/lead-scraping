import { prisma } from '@hyperscale/database';
import type { BaseAdapter } from '../base.js';
import { InstagramTier2Adapter } from './tier2.js';
import { InstagramTier3Adapter } from './tier3.js';

export { InstagramTier2Adapter } from './tier2.js';
export { InstagramTier3Adapter } from './tier3.js';
export {
  qualifyProfile,
  validateBioLink,
  extractCompanyName,
  type RawInstagramProfile,
  type IGQualificationResult,
} from './qualify.js';

export async function getActiveInstagramAdapter(): Promise<BaseAdapter> {
  const config = await prisma.sourceConfig.findUnique({
    where: { source: 'INSTAGRAM' },
  });

  switch (config?.activeTier) {
    case 'TIER_3_INHOUSE':
      return new InstagramTier3Adapter();
    case 'TIER_2_MANAGED':
    default:
      return new InstagramTier2Adapter();
  }
}

import { Injectable } from '@nestjs/common';
import { prisma, type Campaign } from '@hyperscale/database';
import type { Source } from '@hyperscale/types';
import { AlertService } from '../alert/alert.service';
import { createLogger } from '../common/logger';

const logger = createLogger('campaign');

const SOURCE_ENUM_MAP: Record<Source, string> = {
  facebook_ads: 'FACEBOOK_ADS',
  instagram: 'INSTAGRAM',
};

@Injectable()
export class CampaignService {
  constructor(private readonly alertService: AlertService) {}

  async getCampaigns(): Promise<Campaign[]> {
    return prisma.campaign.findMany({ orderBy: { name: 'asc' } });
  }

  async getCampaign(id: string): Promise<Campaign> {
    return prisma.campaign.findUniqueOrThrow({ where: { id } });
  }

  async bootstrapCampaign(source: Source): Promise<Campaign> {
    const enumVal = SOURCE_ENUM_MAP[source] as any;
    const name = `${source}-${Date.now()}`;

    const campaign = await prisma.campaign.create({
      data: {
        name,
        source: enumVal,
        active: true,
        dailySendTarget: 500,
      },
    });

    logger.info({ source, campaignId: campaign.id }, 'Campaign bootstrapped');

    await this.alertService.createAlert(
      'info',
      'campaign_health',
      `New campaign created for ${source}`,
      `Campaign ${name} was auto-bootstrapped`,
      { source, campaignId: campaign.id },
    );

    return campaign;
  }

  async healthCheck(
    campaignId: string,
  ): Promise<{ healthy: boolean; detail: string }> {
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
    });

    if (!campaign.active) {
      return { healthy: false, detail: 'Campaign is paused' };
    }

    if (!campaign.instantlyCampaignId) {
      return { healthy: false, detail: 'No Instantly campaign linked' };
    }

    const uploadedToday = await prisma.lead.count({
      where: {
        instantlyCampaignId: campaign.instantlyCampaignId,
        uploadedAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    });

    const pctTarget =
      campaign.dailySendTarget > 0
        ? (uploadedToday / campaign.dailySendTarget) * 100
        : 0;

    return {
      healthy: true,
      detail: `${uploadedToday}/${campaign.dailySendTarget} uploaded today (${pctTarget.toFixed(0)}%)`,
    };
  }

  async toggleCampaign(id: string, active: boolean): Promise<Campaign> {
    return prisma.campaign.update({
      where: { id },
      data: { active },
    });
  }
}

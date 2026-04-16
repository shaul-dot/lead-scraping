import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { CampaignService } from './campaign.service';
import type { Source } from '@hyperscale/types';

@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Get()
  async list() {
    return this.campaignService.getCampaigns();
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.campaignService.getCampaign(id);
  }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string, @Body() body: { active: boolean }) {
    return this.campaignService.toggleCampaign(id, body.active);
  }

  @Post('bootstrap/:source')
  async bootstrap(@Param('source') source: Source) {
    return this.campaignService.bootstrapCampaign(source);
  }
}

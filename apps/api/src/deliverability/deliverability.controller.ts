import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { DomainService } from './domain.service';
import { InboxService } from './inbox.service';

@Controller('deliverability')
export class DeliverabilityController {
  constructor(
    private readonly domainService: DomainService,
    private readonly inboxService: InboxService,
  ) {}

  @Get('domains')
  async listDomains(@Query('healthStatus') healthStatus?: string) {
    return this.domainService.getDomains(
      healthStatus ? { healthStatus } : undefined,
    );
  }

  @Get('domains/:id')
  async getDomain(@Param('id') id: string) {
    return this.domainService.getDomain(id);
  }

  @Post('domains')
  async createDomain(
    @Body() body: { domain: string; provider?: string; redirectUrl?: string },
  ) {
    return this.domainService.createDomain(body);
  }

  @Get('inboxes')
  async listInboxes(
    @Query('status') status?: string,
    @Query('campaignId') campaignId?: string,
    @Query('domainId') domainId?: string,
  ) {
    return this.inboxService.getInboxes({ status, campaignId, domainId });
  }

  @Post('inboxes')
  async createInbox(
    @Body()
    body: {
      domainId: string;
      email: string;
      persona?: string;
      handler?: string;
    },
  ) {
    return this.inboxService.createInbox(body);
  }

  @Post('inboxes/:id/rotate-out')
  async rotateOut(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return this.inboxService.rotateOut(id, body.reason);
  }

  @Post('inboxes/:id/rotate-in')
  async rotateIn(
    @Param('id') id: string,
    @Body() body: { campaignId: string },
  ) {
    return this.inboxService.rotateIn(id, body.campaignId);
  }

  @Get('capacity')
  async getCapacity() {
    return this.inboxService.getCapacity();
  }
}

import { Injectable } from '@nestjs/common';
import { prisma, type Inbox } from '@hyperscale/database';
import { AlertService } from '../alert/alert.service';
import { createLogger } from '../common/logger';

const logger = createLogger('inbox');

const WARMUP_READY_THRESHOLD = 95;

@Injectable()
export class InboxService {
  constructor(private readonly alertService: AlertService) {}

  async createInbox(data: {
    domainId: string;
    email: string;
    persona?: string;
    handler?: string;
  }): Promise<Inbox> {
    const inbox = await prisma.inbox.create({ data });
    logger.info({ inboxId: inbox.id, email: data.email }, 'Inbox created');
    return inbox;
  }

  async getInboxes(filters?: {
    status?: string;
    campaignId?: string;
    domainId?: string;
  }) {
    const where: Record<string, unknown> = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.campaignId) where.campaignId = filters.campaignId;
    if (filters?.domainId) where.domainId = filters.domainId;

    return prisma.inbox.findMany({
      where,
      include: { domain: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActiveInboxes(campaignId?: string): Promise<number> {
    return prisma.inbox.count({
      where: {
        status: 'ACTIVE',
        ...(campaignId ? { campaignId } : {}),
      },
    });
  }

  async rotateOut(inboxId: string, reason: string): Promise<Inbox> {
    const inbox = await prisma.inbox.update({
      where: { id: inboxId },
      data: {
        status: 'ROTATED_OUT',
        campaignId: null,
        connectedAt: null,
      },
    });

    logger.warn({ inboxId, email: inbox.email, reason }, 'Inbox rotated out');

    await this.alertService.createAlert(
      'warning',
      'inbox_rotation',
      `Inbox ${inbox.email} rotated out`,
      reason,
      { inboxId, email: inbox.email, reason },
    );

    return inbox;
  }

  async rotateIn(inboxId: string, campaignId: string): Promise<Inbox> {
    const inbox = await prisma.inbox.update({
      where: { id: inboxId },
      data: {
        status: 'ACTIVE',
        campaignId,
        connectedAt: new Date(),
      },
    });

    logger.info(
      { inboxId, email: inbox.email, campaignId },
      'Inbox rotated in',
    );
    return inbox;
  }

  async markBurned(inboxId: string): Promise<Inbox> {
    const inbox = await prisma.inbox.update({
      where: { id: inboxId },
      data: {
        status: 'BURNED',
        campaignId: null,
        connectedAt: null,
      },
    });

    logger.error({ inboxId, email: inbox.email }, 'Inbox burned');

    await this.alertService.createAlert(
      'critical',
      'inbox_health',
      `Inbox ${inbox.email} burned`,
      'Inbox has been permanently marked as burned',
      { inboxId, email: inbox.email },
    );

    return inbox;
  }

  async getReadyInboxes(): Promise<Inbox[]> {
    return prisma.inbox.findMany({
      where: {
        status: 'STANDBY',
        warmupEmailsSent: { gte: WARMUP_READY_THRESHOLD },
      },
      include: { domain: true },
    });
  }

  async isReadyForCampaign(inboxId: string): Promise<boolean> {
    const inbox = await prisma.inbox.findUniqueOrThrow({
      where: { id: inboxId },
    });
    return inbox.warmupEmailsSent >= WARMUP_READY_THRESHOLD;
  }

  async getCapacity(): Promise<{
    totalDaily: number;
    utilized: number;
    available: number;
  }> {
    const result = await prisma.inbox.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { dailyCampaignLimit: true },
      _count: true,
    });

    const totalDaily = result._sum.dailyCampaignLimit ?? 0;

    const withCampaign = await prisma.inbox.aggregate({
      where: { status: 'ACTIVE', campaignId: { not: null } },
      _sum: { dailyCampaignLimit: true },
    });

    const utilized = withCampaign._sum.dailyCampaignLimit ?? 0;

    return {
      totalDaily,
      utilized,
      available: totalDaily - utilized,
    };
  }
}

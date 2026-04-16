import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { prisma } from '@hyperscale/database';
import { QueueService } from '../queues/queue.service';

@Controller('replies')
export class ReplyController {
  constructor(private readonly queue: QueueService) {}

  @Get()
  async list(
    @Query('classification') classification?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 50;

    const where: any = { emailReplied: true };
    if (classification) {
      where.replyClassification = classification;
    }

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { replyClassifiedAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        select: {
          id: true,
          companyName: true,
          email: true,
          replyText: true,
          replyClassification: true,
          replyClassifiedAt: true,
          source: true,
          instantlyCampaignId: true,
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return { leads, total, page: p, pageSize: ps };
  }

  @Post(':leadId/reclassify')
  async reclassify(
    @Param('leadId') leadId: string,
    @Body() body: { classification?: string },
  ) {
    if (body.classification) {
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          replyClassification: body.classification as any,
          replyClassifiedAt: new Date(),
        },
      });
      return { success: true, classification: body.classification };
    }

    const lead = await prisma.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { id: true, replyText: true },
    });

    const jobId = await this.queue.addJob('reply:classify', {
      replyId: lead.id,
      body: lead.replyText ?? '',
      leadId: lead.id,
    });

    return { jobId, message: 'Reclassification queued' };
  }
}

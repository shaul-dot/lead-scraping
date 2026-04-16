import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { prisma } from '@hyperscale/database';

@Controller('paperclip')
export class PaperclipController {
  @Get('actions')
  async getActions(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('category') category?: string,
  ) {
    const p = page ? parseInt(page, 10) : 1;
    const ps = pageSize ? parseInt(pageSize, 10) : 50;

    const where = category ? { category } : {};

    const [actions, total] = await Promise.all([
      prisma.paperclipAction.findMany({
        where,
        orderBy: { performedAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      prisma.paperclipAction.count({ where }),
    ]);

    return { actions, total, page: p, pageSize: ps };
  }

  @Get('digest/latest')
  async latestDigest() {
    return prisma.paperclipAction.findFirst({
      where: { category: 'daily_digest' },
      orderBy: { performedAt: 'desc' },
    });
  }

  @Get('strategy/latest')
  async latestStrategy() {
    return prisma.paperclipAction.findFirst({
      where: { category: 'weekly_strategy' },
      orderBy: { performedAt: 'desc' },
    });
  }

  @Post('actions/:id/override')
  async overrideAction(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    return prisma.paperclipAction.update({
      where: { id },
      data: {
        humanFeedback: `OVERRIDE: ${body.reason}`,
      },
    });
  }

  @Post('actions/:id/feedback')
  async addFeedback(
    @Param('id') id: string,
    @Body() body: { feedback: string },
  ) {
    return prisma.paperclipAction.update({
      where: { id },
      data: { humanFeedback: body.feedback },
    });
  }

  @Get('recommendations')
  async pendingRecommendations() {
    return prisma.paperclipAction.findMany({
      where: {
        humanFeedback: null,
        outputResult: {
          path: ['requiresHumanApproval'],
          equals: true,
        },
      },
      orderBy: { performedAt: 'desc' },
    });
  }

  @Post('recommendations/:id/approve')
  async approveRecommendation(@Param('id') id: string) {
    return prisma.paperclipAction.update({
      where: { id },
      data: { humanFeedback: 'APPROVED' },
    });
  }

  @Post('recommendations/:id/reject')
  async rejectRecommendation(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return prisma.paperclipAction.update({
      where: { id },
      data: { humanFeedback: `REJECTED: ${body.reason ?? 'No reason given'}` },
    });
  }
}
